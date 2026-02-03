export class Console {
  public static success(message: string): void {
    return console.log(`✅  [SUCCESS] ${message}`);
  }

  public static info(message: string): void {
    return console.log(`🔵  [INFO] ${message}`);
  }

  public static warn(message: string): void {
    return console.log(`🟡  [WARNING] ${message}`);
  }

  public static error(...args: unknown[]): void {
    return console.log(`❌  [ERROR]`, ...args);
  }
}