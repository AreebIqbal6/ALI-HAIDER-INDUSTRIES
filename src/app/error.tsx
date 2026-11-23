"use client";

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log unexpected errors for SCADA operator review
    console.error('SCADA UI Runtime Error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center bg-[#e8ebf0] p-6 text-center text-slate-900">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600 mb-4 shadow-sm">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 mb-2">
        SCADA View Rendering Error
      </h1>
      <p className="text-xs sm:text-sm text-slate-500 max-w-md mb-6 leading-relaxed">
        An unexpected error occurred while rendering the industrial telemetry view. Local telemetry ingestion remains active in the background.
      </p>
      <div className="flex items-center gap-3">
        <Button
          onClick={() => reset()}
          variant="default"
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer"
        >
          <RotateCcw className="h-4 w-4 mr-1.5" />
          Retry View
        </Button>
        <Link href="/">
          <Button
            variant="outline"
            size="sm"
            className="border-slate-300 text-slate-700 hover:bg-slate-100 font-bold cursor-pointer"
          >
            <Home className="h-4 w-4 mr-1.5" />
            Floor Matrix
          </Button>
        </Link>
      </div>
    </div>
  );
}
