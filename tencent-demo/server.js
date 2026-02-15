import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { signTencentCloud } from "./tencentSign.js";

dotenv.config();

const app = express();
app.use(express.json());

// 允许跨域（Unity需要）
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    next();
});

// 存储任务状态（生产环境建议用Redis）
const jobStatus = new Map();

function saveLog(filename, data) {
    const logDir = path.resolve('./logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    fs.writeFileSync(path.join(logDir, filename), JSON.stringify(data, null, 2), 'utf-8');
}

// 提交3D生成任务
app.post('/generate-3d', async (req, res) => {
    try {
        const { prompt } = req.body;

        const host = "ai3d.tencentcloudapi.com";
        const service = "ai3d";
        const action = "SubmitHunyuanTo3DProJob";
        const version = "2025-05-13";
        const region = "ap-guangzhou";

        const payload = JSON.stringify({ Prompt: prompt });

        const { authorization, timestamp } = signTencentCloud({
            secretId: process.env.TENCENTCLOUD_SECRET_ID,
            secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
            service,
            host,
            payload
        });

        const response = await fetch(`https://${host}`, {
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

        const data = await response.json();
        console.log("✅ 提交任务响应:", JSON.stringify(data, null, 2));
        saveLog(`submit_${Date.now()}.json`, data);

        if (data.Response && data.Response.JobId) {
            const jobId = data.Response.JobId;
            
            // 初始化任务状态
            jobStatus.set(jobId, {
                status: "PROCESSING",
                progress: 0,
                modelUrl: null,
                createdAt: new Date().toISOString()
            });

            res.json({ success: true, jobId });

            // 开始自动轮询（5秒一次，因为生成很快）
            pollJob(jobId, 5000);
        } else {
            res.json({
                success: false,
                error: data.Response?.Error?.Message || "未知错误",
                code: data.Response?.Error?.Code,
                raw: data
            });
        }
    } catch (error) {
        console.error("❌ 错误:", error);
        res.json({ success: false, error: error.message });
    }
});

// 查询任务状态的接口（供Unity调用）
app.get('/job-status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const status = jobStatus.get(jobId);
    
    if (!status) {
        return res.json({ 
            success: false, 
            error: "JobId not found" 
        });
    }
    
    res.json({
        success: true,
        jobId,
        ...status
    });
});

// 自动轮询函数
async function pollJob(jobId, interval = 5000) {
    const host = "ai3d.tencentcloudapi.com";
    const service = "ai3d";
    const action = "QueryHunyuanTo3DProJob";
    const version = "2025-05-13";
    const region = "ap-guangzhou";

    const payload = JSON.stringify({ JobId: jobId }); //改动no parameter

    const { authorization, timestamp } = signTencentCloud({
        secretId: process.env.TENCENTCLOUD_SECRET_ID,
        secretKey: process.env.TENCENTCLOUD_SECRET_KEY,
        service,
        host,
        payload
    });

    try {
        const response = await fetch(`https://${host}`, {
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

        const data = await response.json();
        console.log(`🔍 轮询任务 ${jobId} 响应:`, JSON.stringify(data, null, 2));
        saveLog(`query_${jobId}_${Date.now()}.json`, data);

        // 🔧 修复：根据实际API响应解析
        const apiStatus = data.Response?.Status;
        const errorCode = data.Response?.ErrorCode;
        const errorMessage = data.Response?.ErrorMessage;
        const resultFiles = data.Response?.ResultFile3Ds;

        console.log(`📊 解析状态: Status=${apiStatus}, ErrorCode=${errorCode}`);

        // 检查是否有错误
        if (errorCode && errorCode !== "") {
            console.log(`❌ 任务失败！JobId=${jobId}, 错误: ${errorMessage}`);
            jobStatus.set(jobId, {
                status: "FAILED",
                progress: 0,
                modelUrl: null,
                error: errorMessage || errorCode
            });
            return; // 停止轮询
        }

        // 检查是否完成
        if (apiStatus === "DONE" && resultFiles && resultFiles.length > 0) {
            // ✅ 优先选择GLB格式（单文件，Unity易处理）
            let modelFile = resultFiles.find(f => f.Type === "GLB");
            if (!modelFile) {
                // 如果没有GLB，降级使用OBJ（需要解压ZIP）
                modelFile = resultFiles.find(f => f.Type === "OBJ");
                console.log("⚠️ 没有GLB格式，使用OBJ（ZIP压缩包）");
            }

            if (modelFile && modelFile.Url) {
                console.log(`✅ 任务完成！模型格式: ${modelFile.Type}`);
                console.log(`   URL: ${modelFile.Url}`);
                console.log(`   预览图: ${modelFile.PreviewImageUrl}`);

                jobStatus.set(jobId, {
                    status: "SUCCESS",
                    progress: 100,
                    modelUrl: modelFile.Url,
                    modelType: modelFile.Type,
                    previewImageUrl: modelFile.PreviewImageUrl,
                    completedAt: new Date().toISOString()
                });

                saveLog(`completed_${jobId}.json`, {
                    jobId,
                    modelUrl: modelFile.Url,
                    modelType: modelFile.Type,
                    previewImageUrl: modelFile.PreviewImageUrl,
                    completedAt: new Date().toISOString()
                });

                return; // 停止轮询
            }
        }

        // 如果状态是PROCESSING或其他中间状态，继续轮询
        if (apiStatus === "PROCESSING" || apiStatus === "PENDING" || !apiStatus) {
            // 模拟进度（因为API不返回具体进度）
            const currentStatus = jobStatus.get(jobId);
            const currentProgress = currentStatus?.progress || 0;
            const newProgress = Math.min(currentProgress + 10, 90); // 最多到90%，完成时才100%

            console.log(`⏳ 任务处理中，模拟进度 ${newProgress}%，${interval / 1000}s 后继续轮询...`);
            
            jobStatus.set(jobId, {
                status: "PROCESSING",
                progress: newProgress,
                modelUrl: null
            });

            setTimeout(() => pollJob(jobId, interval), interval);
        } else {
            // 未知状态
            console.log(`⚠️ 未知状态: ${apiStatus}`);
            setTimeout(() => pollJob(jobId, interval), interval);
        }

    } catch (error) {
        console.error(`❌ 轮询任务 ${jobId} 出错:`, error);
        setTimeout(() => pollJob(jobId, interval), interval);
    }
}

app.listen(3000, () => {
    console.log('✅ Server running on http://127.0.0.1:3000');
    console.log('📝 支持的接口:');
    console.log('   POST /generate-3d');
    console.log('   GET  /job-status/:jobId');
});