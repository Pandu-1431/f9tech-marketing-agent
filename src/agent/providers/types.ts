export type TextRequest = {
  system: string;
  prompt: string;
  /** Ask the model to answer with a single JSON object. */
  json?: boolean;
  temperature?: number;
};

export type TextResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

/** Every text model (free or paid) implements this one interface. */
export interface TextProvider {
  readonly name: string;
  readonly model: string;
  generate(req: TextRequest): Promise<TextResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
