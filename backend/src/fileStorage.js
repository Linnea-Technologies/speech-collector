import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

import {
  getCollectionAudioPrefix,
  getMaxAllowedRecordingDurationSeconds,
  getSoundRecordingsRoot,
  normalizeStorageKey,
} from './config.js';

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

export const PROCESSED_AUDIO_FFMPEG_OPTIONS = [
  '-c:a pcm_s16le',
  '-ar 16000',
  '-ac 1',
];

export function getProcessedAudioMetadata() {
  return {
    sample_rate_hz: 16000,
    channel_count: 1,
    encoding: 'pcm_s16le',
  };
}

export function buildRecordingStorageKey(sessionId, taskId, recordingId) {
  if (!recordingId) {
    throw new Error('recordingId is required to build a unique recording storage key.');
  }

  return normalizeStorageKey(sessionId, taskId, `${recordingId}.wav`);
}

export class RecordingTooLongError extends Error {
  constructor(durationSec, maxDurationSec) {
    super('Recording is longer than the allowed maximum.');
    this.name = 'RecordingTooLongError';
    this.code = 'recording_too_long';
    this.durationSec = durationSec;
    this.maxDurationSec = maxDurationSec;
  }
}

export class FileStorage {
  constructor(storageType, options = {}) {
    this.storageType = storageType;
    this.collectionAudioPrefix = getCollectionAudioPrefix();
    this.recordingsRoot = getSoundRecordingsRoot();
    this.tempRoot = path.join(this.recordingsRoot, '_tmp');
    this.maxDurationSec = options.maxDurationSec ?? getMaxAllowedRecordingDurationSeconds();
    this.s3Client = this.initializeS3Client(storageType);
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobe.path);
    ensureDirectory(this.recordingsRoot);
    ensureDirectory(this.tempRoot);

    if (storageType === 'aws-s3') {
      this.bucketName = process.env.AWS_BUCKET_NAME;
    } else if (storageType === 'r2') {
      this.bucketName = process.env.CF_R2_BUCKET_NAME;
    }
  }

  initializeS3Client(storageType) {
    if (storageType === 'r2') {
      return new S3Client({
        region: 'auto',
        endpoint: process.env.CF_R2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.CF_R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY,
        },
      });
    }

    if (storageType === 'aws-s3') {
      return new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });
    }

    if (storageType !== 'local') {
      throw new Error('Specified storage type not implemented.');
    }

    return null;
  }

  getObjectKey(storageKey) {
    return normalizeStorageKey(this.collectionAudioPrefix, storageKey);
  }

  getTempFilePath(sessionId, taskId) {
    const timestamp = Date.now();
    return path.join(this.tempRoot, `${sessionId}-${taskId}-${timestamp}.wav`);
  }

  getFinalLocalPath(storageKey) {
    return path.join(this.recordingsRoot, ...storageKey.split('/'));
  }

  async reencodeFile(inputPath) {
    const tempOutputPath = path.join(
      path.dirname(inputPath),
      `processed-${path.basename(inputPath)}`
    );

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .output(tempOutputPath)
        .outputOptions(PROCESSED_AUDIO_FFMPEG_OPTIONS)
        .on('end', () => {
          fs.renameSync(tempOutputPath, inputPath);
          resolve();
        })
        .on('error', (error) => {
          if (fs.existsSync(tempOutputPath)) {
            fs.unlinkSync(tempOutputPath);
          }
          reject(error);
        })
        .run();
    });
  }

  async getAudioDurationSec(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (error, metadata) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(metadata?.format?.duration || null);
      });
    });
  }

  async persistLocally(tempFilePath, storageKey) {
    const finalPath = this.getFinalLocalPath(storageKey);
    ensureDirectory(path.dirname(finalPath));

    if (fs.existsSync(finalPath)) {
      throw new Error(`Refusing to overwrite an existing recording: ${storageKey}`);
    }

    fs.copyFileSync(tempFilePath, finalPath);
    return finalPath;
  }

  async uploadToS3(filePath, objectKey) {
    const fileBuffer = fs.readFileSync(filePath);
    const response = await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
        Body: fileBuffer,
        ContentType: 'audio/wav',
      })
    );

    return response;
  }

  async downloadObject(objectKey, destinationPath, options = {}) {
    if (!this.s3Client) {
      throw new Error('Remote download is only available for S3-compatible storage.');
    }

    const bucketName = options.bucketName || this.bucketName;
    if (!bucketName) {
      throw new Error('Bucket name is required to download a storage object.');
    }

    ensureDirectory(path.dirname(destinationPath));
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
      })
    );

    if (!response.Body) {
      throw new Error(`Storage object ${objectKey} did not include a response body.`);
    }

    await pipeline(response.Body, fs.createWriteStream(destinationPath));
    return destinationPath;
  }

  async saveRecording(file, { sessionId, taskId, recordingId }) {
    const storageKey = buildRecordingStorageKey(sessionId, taskId, recordingId);
    const tempFilePath = this.getTempFilePath(sessionId, `${taskId}-${recordingId}`);

    try {
      if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
        throw new Error('Invalid or empty buffer provided.');
      }

      fs.writeFileSync(tempFilePath, file.buffer);
      await this.reencodeFile(tempFilePath);
      const durationSec = await this.getAudioDurationSec(tempFilePath);

      if (!durationSec) {
        throw new Error('Could not determine audio duration.');
      }

      if (durationSec > this.maxDurationSec) {
        throw new RecordingTooLongError(durationSec, this.maxDurationSec);
      }

      if (this.storageType === 'local') {
        await this.persistLocally(tempFilePath, storageKey);
        return {
          storageType: this.storageType,
          storageKey: toPosixPath(storageKey),
          objectKey: toPosixPath(storageKey),
          durationSec,
          bucketName: null,
          processedAudio: getProcessedAudioMetadata(),
        };
      }

      const objectKey = this.getObjectKey(storageKey);
      await this.uploadToS3(tempFilePath, objectKey);

      return {
        storageType: this.storageType,
        storageKey: toPosixPath(storageKey),
        objectKey: toPosixPath(objectKey),
        durationSec,
        bucketName: this.bucketName,
        processedAudio: getProcessedAudioMetadata(),
      };
    } catch (error) {
      console.error(`Error saving file: ${error.message}`);
      throw error;
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  }
}

export default FileStorage;
