export function safeProviderUrl(value: string, hosts: string[]): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !hosts.includes(url.hostname)) return undefined;
    return url.href;
  } catch { return undefined; }
}