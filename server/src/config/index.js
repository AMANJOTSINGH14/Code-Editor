const dotenv = require("dotenv");
const path = require("path");
const { z } = require("zod");

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  MONGO_URI: z.string(),
  REDIS_URL: z.string().optional().default(""),
  REDIS_PREFIX: z.string().default("collab"),
  CACHE_TTL_SECONDS: z.coerce.number().default(120),
  JWT_ACCESS_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  COOKIE_SECURE: z.string().default("false").transform(v => v === "true"),
  COOKIE_DOMAIN: z.string().optional().default(""),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  RATE_LIMIT_REVIEWS_PER_HOUR: z.coerce.number().default(10),
  RATE_LIMIT_API_WINDOW_SECONDS: z.coerce.number().default(60),
  RATE_LIMIT_API_MAX: z.coerce.number().default(120),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  GEMINI_EMBEDDING_MODEL: z.string().default("text-embedding-004"),
  CHROMA_URL: z.string().default("http://localhost:8000"),
  RAG_DOCS_PATH: z.string().default("./rag-data/sample-docs"),
  YJS_PERSIST_DEBOUNCE_MS: z.coerce.number().default(5000),
  YJS_PERSIST_MAX_MS: z.coerce.number().default(30000),
  YJS_ROOM_TTL_MS: z.coerce.number().default(300000),
  AUTO_SAVE_LIMIT: z.coerce.number().default(50),
  AUTO_SAVE_INTERVAL_MS: z.coerce.number().default(300000),
  LOG_LEVEL: z.string().default("info")
});

const env = envSchema.parse(process.env);

const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  clientUrl: env.CLIENT_URL,
  mongoUri: env.MONGO_URI,
  redisUrl: env.REDIS_URL,
  redisPrefix: env.REDIS_PREFIX,
  cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN
  },
  cookies: {
    secure: env.COOKIE_SECURE,
    domain: env.COOKIE_DOMAIN,
    sameSite: env.COOKIE_SAMESITE
  },
  rateLimits: {
    reviewsPerHour: env.RATE_LIMIT_REVIEWS_PER_HOUR,
    apiWindowSeconds: env.RATE_LIMIT_API_WINDOW_SECONDS,
    apiMax: env.RATE_LIMIT_API_MAX
  },
  gemini: {
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    embeddingModel: env.GEMINI_EMBEDDING_MODEL
  },
  chromaUrl: env.CHROMA_URL,
  ragDocsPath: env.RAG_DOCS_PATH,
  yjs: {
    persistDebounceMs: env.YJS_PERSIST_DEBOUNCE_MS,
    persistMaxMs: env.YJS_PERSIST_MAX_MS,
    roomTtlMs: env.YJS_ROOM_TTL_MS,
    autoSaveLimit: env.AUTO_SAVE_LIMIT,
    autoSaveIntervalMs: env.AUTO_SAVE_INTERVAL_MS
  },
  logLevel: env.LOG_LEVEL
};

module.exports = config;
