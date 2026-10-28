import { credentialAuthorization } from "../auth/credential";
import { authServiceBase } from "../auth/endpoints";

/**
 * What support did while consent was on, as the account reads it.
 *
 * Consent given once is not the same as being told each time, so every impersonation leaves
 * a notice. One reader serves both surfaces — the support dialog lists them and the app
 * draws a strip while anything is unread — because two readers would eventually disagree
 * about what "unread" means.
 *
 * A build with no account service answers an empty list rather than failing: a notice is an
 * explanation, not a feature.
 */
export interface AccountNotice {
  id: number;
  kind: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export interface NoticeList {
  notices: AccountNotice[];
  unread: number;
}

const EMPTY: NoticeList = { notices: [], unread: 0 };

export async function readNotices(): Promise<NoticeList> {
  if (import.meta.env.VITE_SUITE_MODE === "standalone") return EMPTY;
  let authorization: Record<string, string> = {};
  try {
    authorization = await credentialAuthorization();
  } catch {
    return EMPTY;
  }
  const response = await fetch(`${authServiceBase()}/api/account/notices`, {
    headers: { ...authorization },
    credentials: "include",
  });
  if (!response.ok) return EMPTY;
  const body = (await response.json()) as Partial<NoticeList>;
  return { notices: body.notices ?? [], unread: body.unread ?? 0 };
}

export async function markNoticeRead(id: number): Promise<void> {
  const authorization = await credentialAuthorization();
  await fetch(`${authServiceBase()}/api/account/notices/${id}`, {
    method: "PUT",
    headers: { ...authorization },
    credentials: "include",
  });
}
