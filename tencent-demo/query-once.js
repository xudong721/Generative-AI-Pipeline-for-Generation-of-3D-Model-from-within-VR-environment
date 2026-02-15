import fetch from "node-fetch";
import { signTencentCloud } from "./tencentSign.js";
import dotenv from "dotenv";

dotenv.config();

const jobId = "1400224250220388352";

const host = "ai3d.tencentcloudapi.com";
const service = "ai3d";
const action = "QueryHunyuanTo3DProJob";
const version = "2025-05-13";
const region = "ap-guangzhou";

// ✅ 修改这里
const payload = JSON.stringify({
  JobId: jobId
});

const { authorization, timestamp } = signTencentCloud({
  secretId: process.env.TENCENTCLOUD_SECRET_ID,
  secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
  service,
  host,
  payload
});

const res = await fetch(`https://${host}`, {
  method: "POST",
  headers: {
    "Authorization": authorization,
    "Content-Type": "application/json; charset=utf-8",
    "Host": host,
    "X-TC-Action": action,
    "X-TC-Version": version,
    "X-TC-Region": region,
    "X-TC-Timestamp": timestamp.toString()
  },
  body: payload
});

const data = await res.json();
console.log("🔍 最终查询结果：");
console.log(JSON.stringify(data, null, 2));
