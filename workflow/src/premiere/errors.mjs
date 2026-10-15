// This type may be raised only by local checks before a host mutation is sent.
// Host error payloads and arbitrary error properties cannot certify refusal.
export class PremierePreflightRefusal extends Error {
  constructor(message) {super(message);this.name='PremierePreflightRefusal';}
}
