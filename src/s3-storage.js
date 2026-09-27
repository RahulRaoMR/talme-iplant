const path = require("node:path");
const { Readable } = require("node:stream");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { awsRegion, awsS3Bucket } = require("./config");

let s3Client;

function requireS3Config() {
  if (!awsRegion || !awsS3Bucket) {
    const error = new Error("AWS_REGION and AWS_S3_BUCKET are required for S3 file storage.");
    error.statusCode = 500;
    throw error;
  }
}

function getS3Client() {
  requireS3Config();
  if (!s3Client) {
    s3Client = new S3Client({ region: awsRegion });
  }
  return s3Client;
}

function safeFileName(fileName) {
  return path.basename(String(fileName || "resume")).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function employeeResumeKey(employeeId, fileName) {
  const safeEmployeeId = String(employeeId || "").replace(/[^a-zA-Z0-9._:-]/g, "_");
  if (!safeEmployeeId) {
    const error = new Error("employeeId is required for employee resume storage.");
    error.statusCode = 400;
    throw error;
  }
  return `employees/${safeEmployeeId}/resume/${Date.now()}-${safeFileName(fileName)}`;
}

function normalizeBody(body) {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array || body instanceof Readable) return body;
  if (body?.buffer) return body.buffer;
  const error = new Error("A file buffer or stream is required for S3 upload.");
  error.statusCode = 400;
  throw error;
}

async function uploadEmployeeResume({ employeeId, fileName, contentType, body, key }) {
  const objectKey = key || employeeResumeKey(employeeId, fileName);
  await getS3Client().send(new PutObjectCommand({
    Bucket: awsS3Bucket,
    Key: objectKey,
    Body: normalizeBody(body),
    ContentType: contentType || "application/octet-stream",
    Metadata: {
      employee_id: String(employeeId || "")
    }
  }));
  return {
    bucket: awsS3Bucket,
    key: objectKey,
    fileName: safeFileName(fileName),
    contentType: contentType || "application/octet-stream"
  };
}

async function getEmployeeResume({ key }) {
  if (!key) {
    const error = new Error("S3 object key is required.");
    error.statusCode = 404;
    throw error;
  }
  const result = await getS3Client().send(new GetObjectCommand({
    Bucket: awsS3Bucket,
    Key: key
  }));
  return {
    body: result.Body,
    contentType: result.ContentType || "application/octet-stream",
    contentLength: result.ContentLength || null,
    lastModified: result.LastModified || null
  };
}

async function headEmployeeResume({ key }) {
  if (!key) return null;
  return getS3Client().send(new HeadObjectCommand({
    Bucket: awsS3Bucket,
    Key: key
  }));
}

async function createEmployeeResumeDownloadUrl({ key, fileName, expiresIn = 300 }) {
  if (!key) {
    const error = new Error("S3 object key is required.");
    error.statusCode = 404;
    throw error;
  }
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: awsS3Bucket,
      Key: key,
      ResponseContentDisposition: `inline; filename="${safeFileName(fileName)}"`
    }),
    { expiresIn: Math.min(Math.max(Number(expiresIn) || 300, 60), 3600) }
  );
}

async function deleteEmployeeResume({ key }) {
  if (!key) return false;
  await getS3Client().send(new DeleteObjectCommand({
    Bucket: awsS3Bucket,
    Key: key
  }));
  return true;
}

async function replaceEmployeeResume({ previousKey, employeeId, fileName, contentType, body, deletePrevious = false }) {
  const uploaded = await uploadEmployeeResume({ employeeId, fileName, contentType, body });
  if (deletePrevious && previousKey && previousKey !== uploaded.key) {
    await deleteEmployeeResume({ key: previousKey });
  }
  return uploaded;
}

module.exports = {
  employeeResumeKey,
  uploadEmployeeResume,
  getEmployeeResume,
  headEmployeeResume,
  createEmployeeResumeDownloadUrl,
  deleteEmployeeResume,
  replaceEmployeeResume
};
