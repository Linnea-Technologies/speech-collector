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

function assertPathInside(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to access storage path outside recordings root: ${targetPath}`);
  }
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getRecordingMetadata(recording) {
  const metadata = recording?.recording_metadata || recording?.metadata || {};
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
}

function getRecordingStorageMetadata(recording) {
  const metadata = getRecordingMetadata(recording);
  return metadata.storage && typeof metadata.storage === 'object' && !Array.isArray(metadata.storage)
    ? metadata.storage
    : {};
}

function getRecordingStorageType(recording, fallback) {
  return normalizeOptionalString(recording?.storage_type) || normalizeOptionalString(recording?.storageType) || fallback;
}

function parseRangeHeader(rangeHeader, totalSize) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : null;
  let end = match[2] ? Number.parseInt(match[2], 10) : null;

  if (start === null && end === null) {
    return null;
  }

  if (start === null) {
    const suffixLength = Math.min(end, totalSize);
    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  } else if (end === null || end >= totalSize) {
    end = totalSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalSize) {
    return null;
  }

  return { start, end };
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

export function buildMetadataSidecarStorageKey(audioStorageKey) {
  const storageKey = normalizeStorageKey(audioStorageKey);
  if (!storageKey) {
    throw new Error('audioStorageKey is required to build a metadata sidecar storage key.');
  }

  return /\.wav$/i.test(storageKey) ? storageKey.replace(/\.wav$/i, '.json') : `${storageKey}.json`;
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

  getRecordingObjectKey(recording) {
    const storageMetadata = getRecordingStorageMetadata(recording);
    const metadata = getRecordingMetadata(recording);
    const explicitObjectKey =
      normalizeOptionalString(recording?.objectKey) ||
      normalizeOptionalString(recording?.object_key) ||
      normalizeOptionalString(storageMetadata.object_key) ||
      normalizeOptionalString(metadata.object_key);

    if (explicitObjectKey) {
      return normalizeStorageKey(explicitObjectKey);
    }

    const storageKey = normalizeStorageKey(recording?.storage_key || recording?.storageKey);
    const storageType = getRecordingStorageType(recording, this.storageType);
    return storageType === 'local' ? storageKey : this.getObjectKey(storageKey);
  }

  getRecordingBucketName(recording) {
    const storageMetadata = getRecordingStorageMetadata(recording);
    const metadata = getRecordingMetadata(recording);
    return (
      normalizeOptionalString(recording?.bucketName) ||
      normalizeOptionalString(recording?.bucket_name) ||
      normalizeOptionalString(storageMetadata.bucket_name) ||
      normalizeOptionalString(metadata.bucket_name) ||
      this.bucketName ||
      null
    );
  }

  getMetadataSidecarInfo(recording) {
    const storageType = getRecordingStorageType(recording, this.storageType);
    const audioStorageKey = normalizeStorageKey(recording?.storage_key || recording?.storageKey);
    const audioObjectKey = this.getRecordingObjectKey(recording);
    const metadataStorageKey = buildMetadataSidecarStorageKey(audioStorageKey);
    const metadataObjectKey =
      storageType === 'local'
        ? metadataStorageKey
        : buildMetadataSidecarStorageKey(audioObjectKey || this.getObjectKey(audioStorageKey));

    return {
      storage_type: storageType,
      storage_key: metadataStorageKey,
      object_key: metadataObjectKey,
      metadata_object_key: metadataObjectKey,
      bucket_name: this.getRecordingBucketName(recording),
    };
  }

  getTempFilePath(sessionId, taskId) {
    const timestamp = Date.now();
    return path.join(this.tempRoot, `${sessionId}-${taskId}-${timestamp}.wav`);
  }

  getFinalLocalPath(storageKey) {
    const finalPath = path.join(this.recordingsRoot, ...storageKey.split('/'));
    assertPathInside(this.recordingsRoot, finalPath);
    return finalPath;
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

  async getRecordingAudioStream(recording, options = {}) {
    const storageType = getRecordingStorageType(recording, this.storageType);
    const rangeHeader = normalizeOptionalString(options.rangeHeader);

    if (storageType === 'local') {
      const storageKey = normalizeStorageKey(recording?.storage_key || recording?.storageKey);
      const filePath = this.getFinalLocalPath(storageKey);
      const stats = fs.statSync(filePath);
      const range = parseRangeHeader(rangeHeader, stats.size);
      const contentLength = range ? range.end - range.start + 1 : stats.size;
      const stream = range
        ? fs.createReadStream(filePath, { start: range.start, end: range.end })
        : fs.createReadStream(filePath);

      return {
        stream,
        statusCode: range ? 206 : 200,
        contentType: 'audio/wav',
        contentLength,
        headers: {
          'Accept-Ranges': 'bytes',
          ...(range
            ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}` }
            : {}),
        },
      };
    }

    if (storageType === 'aws-s3' || storageType === 'r2') {
      if (!this.s3Client) {
        throw new Error(`Storage client is not configured for ${storageType}.`);
      }

      const objectKey = this.getRecordingObjectKey(recording);
      const bucketName = this.getRecordingBucketName(recording);
      if (!objectKey || !bucketName) {
        throw new Error('Object key and bucket name are required to stream remote audio.');
      }

      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        })
      );

      if (!response.Body) {
        throw new Error(`Storage object ${objectKey} did not include a response body.`);
      }

      return {
        stream: response.Body,
        statusCode: rangeHeader ? 206 : 200,
        contentType: response.ContentType || 'audio/wav',
        contentLength: response.ContentLength,
        headers: {
          'Accept-Ranges': 'bytes',
          ...(response.ContentRange ? { 'Content-Range': response.ContentRange } : {}),
        },
      };
    }

    throw new Error(`Unsupported storage type for audio stream: ${storageType}`);
  }

  async writeJsonSidecar(recording, data) {
    const storageType = getRecordingStorageType(recording, this.storageType);
    const sidecarInfo = this.getMetadataSidecarInfo(recording);
    const body =
      typeof data === 'string'
        ? Buffer.from(data, 'utf-8')
        : Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf-8');

    if (storageType === 'local') {
      const filePath = this.getFinalLocalPath(sidecarInfo.storage_key);
      ensureDirectory(path.dirname(filePath));
      fs.writeFileSync(filePath, body);
      return {
        ...sidecarInfo,
        file_path: filePath,
      };
    }

    if (storageType === 'aws-s3' || storageType === 'r2') {
      if (!this.s3Client) {
        throw new Error(`Storage client is not configured for ${storageType}.`);
      }

      if (!sidecarInfo.bucket_name) {
        throw new Error('Bucket name is required to write a metadata sidecar.');
      }

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: sidecarInfo.bucket_name,
          Key: sidecarInfo.metadata_object_key,
          Body: body,
          ContentType: 'application/json',
        })
      );

      return sidecarInfo;
    }

    throw new Error(`Unsupported storage type for metadata sidecar: ${storageType}`);
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
