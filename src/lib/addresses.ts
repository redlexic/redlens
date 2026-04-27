import type { AddressInfo } from "../types";
import { fetchJsonVerified } from "./verify";

let cached: Promise<Record<string, AddressInfo>> | null = null;

export function loadAddresses(): Promise<Record<string, AddressInfo>> {
  if (!cached) {
    cached = fetchJsonVerified<Record<string, AddressInfo>>(
      `${import.meta.env.BASE_URL}addresses.json`,
      "addresses.json",
    );
  }
  return cached;
}
