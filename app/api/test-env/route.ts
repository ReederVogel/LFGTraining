import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  const apiKey = process.env.NEXT_PUBLIC_LIVEAVATAR_API_KEY;
  
  // Check if .env.local file exists
  const envLocalPath = path.join(process.cwd(), '.env.local');
  const envLocalExists = fs.existsSync(envLocalPath);
  let envLocalContent = null;
  
  if (envLocalExists) {
    try {
      envLocalContent = fs.readFileSync(envLocalPath, 'utf-8');
    } catch (e) {
      envLocalContent = 'Error reading file';
    }
  }
  
  // Get all env vars that might be relevant
  const allEnvVars = Object.keys(process.env)
    .filter(k => k.includes('LIVEAVATAR') || k.includes('API') || k.includes('NEXT'))
    .reduce((acc, key) => {
      acc[key] = process.env[key] ? `${process.env[key]?.substring(0, 10)}...` : 'not set';
      return acc;
    }, {} as Record<string, string>);
  
  return NextResponse.json({
    hasApiKey: !!apiKey,
    apiKeyLength: apiKey?.length || 0,
    apiKeyPreview: apiKey ? `${apiKey.substring(0, 10)}...` : 'not set',
    envKeys: Object.keys(process.env).filter(k => k.includes('LIVEAVATAR')),
    envLocalExists,
    envLocalContent: envLocalContent?.substring(0, 100),
    cwd: process.cwd(),
    allEnvVars,
    nodeEnv: process.env.NODE_ENV,
  });
}

