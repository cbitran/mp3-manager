import { invoke } from "@tauri-apps/api/core";

// Preencha quando o produto estiver criado no LemonSqueezy.
// Ex: "https://tagwave.lemonsqueezy.com/buy/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export const LS_PRODUCT_URL = "";

export interface LicenseStatus {
  valid:       boolean;
  email:       string;
  instance_id: string;
  error?:      string;
}

export async function activateLicenseKey(key: string): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("activate_license_key", { key });
}

export async function checkLicenseStatus(): Promise<LicenseStatus> {
  return invoke<LicenseStatus>("check_license_status");
}
