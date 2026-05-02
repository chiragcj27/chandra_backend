import { env } from "../../config/env";

type DeepgramResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
};

export async function transcribeBulkOrderAudio(args: {
  audioBuffer: Buffer;
  mimetype: string;
}): Promise<string> {
  if (!env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not configured");
  }
  if (!args.audioBuffer?.length) {
    throw new Error("audioBuffer is empty");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Number(env.BULK_ORDER_DEEPGRAM_TIMEOUT_MS || 20000)),
  );

  try {
    const requestDeepgram = async (url: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
          "Content-Type": args.mimetype || "application/octet-stream",
        },
        body: new Uint8Array(args.audioBuffer),
        signal: controller.signal,
      });

    const primaryUrl =
      "https://api.deepgram.com/v1/listen?model=nova-2&language=en-IN&smart_format=true&punctuate=true&numerals=true";
    let response = await requestDeepgram(primaryUrl);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Deepgram transcription failed (${response.status}): ${body.slice(0, 200)}`);
    }

    let data = (await response.json()) as DeepgramResponse;
    let transcript =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";

    // Fallback pass: let Deepgram auto-detect language/model nuances for noisy clips.
    if (!transcript) {
      const fallbackUrl =
        "https://api.deepgram.com/v1/listen?smart_format=true&punctuate=true&numerals=true&detect_language=true";
      response = await requestDeepgram(fallbackUrl);
      if (response.ok) {
        data = (await response.json()) as DeepgramResponse;
        transcript =
          data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
      }
    }

    return transcript;
  } finally {
    clearTimeout(timeout);
  }
}
