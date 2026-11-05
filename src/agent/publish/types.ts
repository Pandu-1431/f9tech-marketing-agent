/** What a publisher gets: the approved caption and the approved media. */
export type PublishInput = {
  text: string;
  image?: { data: Buffer; mime: string; publicUrl?: string | null } | null;
  video?: { data: Buffer; mime: string; publicUrl?: string | null } | null;
};

export type PublishResult = { externalId: string; url: string | null };

export type ChannelAuth = { token: string; config: Record<string, string> };

/** A publishing failure that will not get better by retrying (bad token, missing permission...). */
export class PublishConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishConfigError";
  }
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

export const blob = (data: Buffer, mime: string) => new Blob([new Uint8Array(data)], { type: mime });
