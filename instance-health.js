#!/usr/bin/env node

import { execSync } from "child_process";
import os from "os";
import axios from "axios";

// --- CONFIG ---
const ES_URL = "http://localhost:9200";
const AUTH_USER = "username";  // 🔐 replace with your credentials
const AUTH_PASS = "password";
const INDEX_BASE = "instance_checks";
const INDEX = `${INDEX_BASE}-${new Date().toISOString().slice(0, 7).replace("-", "")}`; // instance_checks-YYYYMM

// Axios client with basic auth and JSON defaults
const api = axios.create({
  baseURL: ES_URL,
  auth: { username: AUTH_USER, password: AUTH_PASS },
  headers: { "Content-Type": "application/json" },
  timeout: 8000
});

// --- Utility functions ---
const exec = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

function getDiskUsage() {
  try {
    const output = exec("df -h --output=source,pcent,target | grep -vE '^Filesystem|tmpfs|udev'");
    return output.split("\n").map((line) => {
      const [device, percent, mount] = line.trim().split(/\s+/);
      return { device, used_percent: parseFloat(percent.replace("%", "")), mount };
    });
  } catch {
    return [];
  }
}

function getMemoryUsage() {
  const total = os.totalmem() / 1e9;
  const free = os.freemem() / 1e9;
  const used = total - free;
  return {
    total_gb: +total.toFixed(2),
    used_gb: +used.toFixed(2),
    used_percent: +(used / total * 100).toFixed(2)
  };
}

function getCpuLoad() {
  const [one, five, fifteen] = os.loadavg();
  return { one_min: one, five_min: five, fifteen_min: fifteen };
}

function getUptime() {
  const s = os.uptime();
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

// --- Elasticsearch helpers ---
async function ensureIndexExists() {
  const mapping = {
    settings: {
      number_of_replicas: 0, // 🔑 disable replicas for single-node cluster
    },
    mappings: {
      properties: {
        timestamp: { type: "date" },
        hostname: { type: "keyword" },
        platform: { type: "keyword" },
        uptime: { type: "keyword" },
        cpu_load: {
          properties: {
            one_min: { type: "float" },
            five_min: { type: "float" },
            fifteen_min: { type: "float" }
          }
        },
        memory: {
          properties: {
            total_gb: { type: "float" },
            used_gb: { type: "float" },
            used_percent: { type: "float" }
          }
        },
        disks: {
          type: "nested",
          properties: {
            device: { type: "keyword" },
            mount: { type: "keyword" },
            used_percent: { type: "float" }
          }
        },
        elasticsearch_health: {
          properties: {
            status: { type: "keyword" },
            active_shards: { type: "integer" },
            unassigned_shards: { type: "integer" },
            number_of_nodes: { type: "integer" }
          }
        }
      }
    }
  };

  try {
    await api.head(`/${INDEX}`);
    console.log(`Index ${INDEX} already exists`);
  } catch (err) {
    if (err.response?.status === 404) {
      console.log(`Creating index: ${INDEX}`);
      await api.put(`/${INDEX}`, mapping);
    } else {
      throw err;
    }
  }
}

async function getClusterHealth() {
  try {
    const res = await api.get("/_cluster/health");
    return res.data;
  } catch {
    return { error: "Failed to retrieve cluster health" };
  }
}

// --- Main logic ---
(async () => {
  try {
    await ensureIndexExists();

    const report = {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: getUptime(),
      cpu_load: getCpuLoad(),
      memory: getMemoryUsage(),
      disks: getDiskUsage(),
      elasticsearch_health: await getClusterHealth()
    };

    const r = await api.post(`/${INDEX}/_doc`, report);
    console.log(`✅ Indexed report to ${INDEX}:`, r.status);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();
