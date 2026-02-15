import crypto from "crypto";

function sha256(message, secret = "", encoding) {
    const hmac = crypto.createHmac("sha256", secret);
    return hmac.update(message).digest(encoding);
}

function hash(message, encoding = "hex") {
    return crypto.createHash("sha256").update(message).digest(encoding);
}

function getUTCDate(timestamp) {
    const date = new Date(timestamp * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export function signTencentCloud({
    secretId,
    secretKey,
    service,
    host,
    payload
}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const date = getUTCDate(timestamp);

    const httpMethod = "POST";
    const canonicalUri = "/";
    const canonicalQueryString = "";
    const signedHeaders = "content-type;host";
    const canonicalHeaders =
        `content-type:application/json; charset=utf-8\nhost:${host}\n`;

    const hashedPayload = hash(payload);

    const canonicalRequest =
        httpMethod + "\n" +
        canonicalUri + "\n" +
        canonicalQueryString + "\n" +
        canonicalHeaders + "\n" +
        signedHeaders + "\n" +
        hashedPayload;

    const algorithm = "TC3-HMAC-SHA256";
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign =
        algorithm + "\n" +
        timestamp + "\n" +
        credentialScope + "\n" +
        hash(canonicalRequest);

    const kDate = sha256(date, "TC3" + secretKey);
    const kService = sha256(service, kDate);
    const kSigning = sha256("tc3_request", kService);
    const signature = sha256(stringToSign, kSigning, "hex");

    const authorization =
        `${algorithm} Credential=${secretId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return { authorization, timestamp };
}
