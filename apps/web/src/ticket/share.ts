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
