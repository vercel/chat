export class SlackBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SlackBlockError";
  }
}
