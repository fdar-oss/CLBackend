export default () => ({
  port: parseInt(process.env.PORT || '', 10) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '', 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '', 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  },

  wati: {
    apiUrl: process.env.WATI_API_URL,
    apiToken: process.env.WATI_API_TOKEN,
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    fromNumber: process.env.TWILIO_FROM_NUMBER,
  },

  fbr: {
    apiUrl: process.env.FBR_API_URL,
    apiKey: process.env.FBR_API_KEY,
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    publicUrl: process.env.S3_PUBLIC_URL,
  },
});
