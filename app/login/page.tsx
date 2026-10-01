'use client';

import { Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

function LoginInner() {
  const params = useSearchParams();
  const error = params.get('error');
  const callbackUrl = params.get('callbackUrl') || '/';
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon-512.png" alt="USAIndiaCFO" className="mx-auto mb-2 size-12 rounded-lg" />
        <CardTitle>Growth Center</CardTitle>
        <CardDescription>Sign in with your @usaindiacfo.com Google account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error === 'AccessDenied'
                ? 'Only @usaindiacfo.com Google accounts can sign in.'
                : 'Sign-in failed. Please try again.'}
            </AlertDescription>
          </Alert>
        )}
        <Button className="w-full" onClick={() => signIn('google', { callbackUrl })}>
          Continue with Google
        </Button>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Suspense>
        <LoginInner />
      </Suspense>
    </div>
  );
}
