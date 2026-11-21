import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col items-center justify-center bg-zinc-50 p-6 text-center text-zinc-950">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 mb-4">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-950 mb-2">
        Page Not Found (404)
      </h1>
      <p className="text-sm text-zinc-500 max-w-sm mb-6">
        The requested industrial SCADA view or endpoint does not exist.
      </p>
      <Link href="/">
        <Button variant="default" size="sm">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Return to Floor Overview
        </Button>
      </Link>
    </div>
  );
}
