/**
 * Code Emitter.
 *
 * A string builder designed for code generation. Tracks indentation,
 * handles multi-line blocks, and formats docstrings.
 */

export class Emitter {
  private lines: string[] = [];
  private indentLevel = 0;
  private indentString = '  ';

  constructor(indentString = '  ') {
    this.indentString = indentString;
  }

  /** Write a line of code with current indentation. */
  line(text = ''): void {
    if (text.length === 0) {
      this.lines.push('');
      return;
    }
    // Handle multi-line strings passed to `line()`
    const lines = text.split('\n');
    for (const l of lines) {
      this.lines.push(this.getIndent() + l);
    }
  }

  /** Increase indentation level for subsequent lines. */
  indent(): void {
    this.indentLevel++;
  }

  /** Decrease indentation level for subsequent lines. */
  dedent(): void {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
  }

  /** Write a block of code, executing the callback inside an indented scope. */
  block(start: string, end: string, cb: () => void): void {
    this.line(start);
    this.indent();
    cb();
    this.dedent();
    this.line(end);
  }

  /** Get the generated code. */
  toString(): string {
    return this.lines.join('\n') + '\n';
  }

  private getIndent(): string {
    return this.indentString.repeat(this.indentLevel);
  }
}
