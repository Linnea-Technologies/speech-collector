import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

import { getCollectionAudioPrefix, getSoundRecordingsRoot, normalizeStorageKey } from './config.js';

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

export function buildRecordingStorageKey(sessionId, taskId) {
  return normalizeStorageKey(sessionId, `${taskId}.wav`);
}

export class FileStorage {
  constructor(storageType) {
    this.storageType = storageType;
    this.collectionAudioPrefix = getCollectionAudioPrefix();
    this.recordingsRoot = getSoundRecordingsRoot();
    this.tempRoot = path.join(this.recordingsRoot, '_tmp');
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
        .outputOptions('-c:a pcm_s16le')
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
      fs.unlinkSync(finalPath);
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

  async saveRecording(file, { sessionId, taskId }) {
    const storageKey = buildRecordingStorageKey(sessionId, taskId);
    const tempFilePath = this.getTempFilePath(sessionId, taskId);

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

      if (this.storageType === 'local') {
        await this.persistLocally(tempFilePath, storageKey);
        return {
          storageType: this.storageType,
          storageKey: toPosixPath(storageKey),
          objectKey: toPosixPath(storageKey),
          durationSec,
          bucketName: null,
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
