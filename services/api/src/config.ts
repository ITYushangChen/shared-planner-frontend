import "dotenv/config";

function read(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(process.env.PORT || 8080),
  corsOrigin: read("CORS_ORIGIN", "*"),
  supabaseUrl: read("SUPABASE_URL"),
  supabaseAnonKey: read("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),
  deepseekApiKey: read("DEEPSEEK_API_KEY"),
  deepseekBaseUrl: read("DEEPSEEK_BASE_URL", "https://api.deepseek.com").replace(
    /\/$/,
    "",
  ),
  deepseekModel: read("DEEPSEEK_MODEL", "deepseek-chat"),
  cronSecret: read("CRON_SECRET"),
};

export function assertRuntimeEnv(): void {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DEEPSEEK_API_KEY",
  ] as const;

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(", ")}`);
  }
}
