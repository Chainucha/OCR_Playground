"use client";

import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Amplify } from "aws-amplify";
// eslint-disable-next-line no-restricted-imports -- Amplify writes this file to the web root at build time
import outputs from "../../../amplify_outputs.json";

const localCognito = process.env.NEXT_PUBLIC_COGNITO_ENDPOINT;

if (localCognito) {
  // Local sign-in keeps the session in localStorage, not cookies (ssr: false). Cookies are shared by every localhost
  // port, and each local launch makes a new user pool with new cookie names, so they pile up until requests fail with
  // HTTP 431. localStorage is per port. Nothing on the server reads the session.
  Amplify.configure(
    {
      Auth: {
        Cognito: {
          userPoolEndpoint: localCognito,
          userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
          userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
          loginWith: { email: true },
        },
      },
    },
    { ssr: false },
  );
} else {
  Amplify.configure(outputs, { ssr: true });
}

// Development only: NEXT_PUBLIC_DEV_AUTH_BYPASS=1 skips the sign-in screen. `next build` always sets NODE_ENV to
// production, so a deployed build signs in through Cognito whatever the variable says.
export const AUTH_BYPASSED =
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1" && process.env.NODE_ENV === "development";

export type Session = { email: string; signOut: (() => void) | null };

function useCognitoSession(): Session {
  const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);
  return { email: user?.signInDetails?.loginId ?? "", signOut };
}

function useBypassedSession(): Session {
  return { email: "dev (sign-in bypassed)", signOut: null };
}

/** Who is signed in, and how to sign out (null when sign-in is bypassed). */
export const useSession = AUTH_BYPASSED ? useBypassedSession : useCognitoSession;

export function Providers({ children }: { children: React.ReactNode }) {
  if (AUTH_BYPASSED) return children;
  return (
    <Authenticator hideSignUp>
      {children}
    </Authenticator>
  );
}
