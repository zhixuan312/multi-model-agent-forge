import { NextResponse } from 'next/server';
import { readBuildInfo } from '@/version/build-info';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(readBuildInfo());
}
