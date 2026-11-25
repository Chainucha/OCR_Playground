"use client";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { Amplify } from "aws-amplify";
import outputs from "../../amplify_outputs.json";

Amplify.configure(outputs, { ssr: true });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Authenticator hideSignUp>
      {children}
    </Authenticator>
  );
}
