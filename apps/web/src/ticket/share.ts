// 分享車票：手機用 Web Share（含圖片）；桌機下載＋Threads 發文連結；App 內建瀏覽器改為長按存圖（docs/PRD.md §8.2）

/** Threads／Instagram／Facebook／LINE 的 App 內建瀏覽器：不保證支援檔案分享與下載 */
export function isInAppBrowser(ua = navigator.userAgent): boolean {
  return /Barcelona|Instagram|FBAN|FBAV|Line\//i.test(ua);
}

/** Threads 官方 Web Intent：只能預填文字（連結放在文字裡），圖片需使用者自行附加 */
export function threadsIntentUrl(text: string) {
  return `https://www.threads.com/intent/post?text=${encodeURIComponent(text)}`;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported';

export async function shareImage(blob: Blob, fileName: string, text: string): Promise<ShareOutcome> {
  const file = new File([blob], fileName, { type: 'image/png' });
  if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await navigator.share({ files: [file], text });
    return 'shared';
  } catch (err) {
    return (err as DOMException).name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

// claude.ai Artifact 的 downloads 能力（只宣告這裡用到的部分）
interface DownloadsNamespace {
  save(req: { filename: string; data: Blob }): Promise<{ status: 'saved' | 'delivered' }>;
}
interface ClaudeHost {
  use(name: 'downloads'): Promise<DownloadsNamespace | null>;
}

export type SaveOutcome = 'saved' | 'declined' | 'unavailable' | 'downloaded';

/**
 * 存下車票圖片。在 claude.ai Artifact 裡，網頁自己觸發的下載會被擋，
 * 改由 downloads 能力請檢視者確認（iOS 的 Claude App 會打開系統分享表單）；一般網頁直接下載。
 */
export async function saveImage(blob: Blob, fileName: string): Promise<SaveOutcome> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!host?.use) {
    downloadImage(blob, fileName);
    return 'downloaded';
  }
  const downloads = await host.use('downloads').catch(() => null);
  if (!downloads) return 'unavailable';
  try {
    await downloads.save({ filename: fileName, data: blob });
    return 'saved';
  } catch (err) {
    return (err as { code?: string }).code === 'declined' ? 'declined' : 'unavailable';
  }
}

export function downloadImage(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
