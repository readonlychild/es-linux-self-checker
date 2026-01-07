#!/usr/bin/env node
/**
 * Export Elasticsearch indices to NDJSON.GZ bulk format
 * and upload each compressed file to S3.
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import axios from "axios";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const ES_URL = "http://localhost:9200";
const AUTH_USER = "username";   // 🔐 update
const AUTH_PASS = "password";   // 🔐 update
const REGION = "us-west-2";
const S3_BUCKET = "my-es-backups";
const OUTPUT_DIR = "/tmp/es-bulk-gz";
const INDEX_PATTERN = "tracking_*"; // wildcard pattern

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const api = axios.create({
  baseURL: ES_URL,
  auth: { username: AUTH_USER, password: AUTH_PASS },
  headers: { "Content-Type": "application/json" },
  timeout: 60000,
});

const s3 = new S3Client({ region: REGION });

// --- list indices matching pattern
async function listIndices() {
  const res = await api.get(`/_cat/indices/${INDEX_PATTERN}?format=json&h=index`);
  return res.data.map(i => i.index);
}

// --- dump index documents to compressed NDJSON
async function exportIndex(index) {
  const dateDir = new Date().toISOString().slice(0, 10);
  const tmpPath = path.join(OUTPUT_DIR, `${index}.ndjson.gz`);
  const gzip = zlib.createGzip();
  const writer = fs.createWriteStream(tmpPath).on("error", console.error);
  gzip.pipe(writer);

  console.log(`📦 Exporting ${index} → ${tmpPath}`);

  const res = await api.get(`/${index}/_search`, {
    params: { scroll: "1m", size: 1000 },
  });

  let hits = res.data.hits.hits;
  let scrollId = res.data._scroll_id;
  let total = 0;

  while (hits.length) {
    for (const h of hits) {
      gzip.write(
        JSON.stringify({ index: { _index: index, _id: h._id } }) + "\n" +
        JSON.stringify(h._source) + "\n"
      );
      total++;
    }
    const scrollRes = await api.post("/_search/scroll", {
      scroll: "1m",
      scroll_id: scrollId,
    });
    hits = scrollRes.data.hits.hits;
    scrollId = scrollRes.data._scroll_id;
  }

  gzip.end();
  await new Promise(r => writer.on("finish", r));
  console.log(`✅ ${index} done (${total} docs)`);

  // Upload to S3
  const Key = `bulk-backups/${dateDir}/${path.basename(tmpPath)}`;
  const fileStream = fs.createReadStream(tmpPath);
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key,
    Body: fileStream,
    ContentType: "application/gzip"
  }));
  console.log(`🪣 Uploaded to s3://${S3_BUCKET}/${Key}`);
  return tmpPath;
}

// --- main runner
(async () => {
  try {
    const indices = await listIndices();
    console.log(`Found ${indices.length} indices.`);
    for (const index of indices) await exportIndex(index);
    console.log("🎯 All exports complete!");
  } catch (err) {
    console.error("❌ Export failed:", err.message);
  }
})();