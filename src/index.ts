import {
  Comment,
  getSchema,
  PrismaParser,
  Schema,
  VisitorClassFactory,
} from '@mrleebo/prisma-ast';
import type { CstNodeLocation } from 'chevrotain';
import { IRecognitionException, isRecognitionException } from 'chevrotain';
import { AST, Linter } from 'eslint';
import * as ESTree from 'estree';
import ParserOptions = Linter.ParserOptions;
import ESLintParseResult = Linter.ESLintParseResult;
import Program = AST.Program;

export const meta = {
  name: 'prisma-eslint-parser',
  version: '1.1.2',
};

/**
 * Build a minimal ESTree‐compatible Program node, attaching:
 *   • range + loc for the overall file
 *   • prismaAst (the full Prisma AST) under a custom property
 *   • empty tokens/comments arrays (rules can still walk prismaAst)
 */
function buildESTreeProgram(
  code: string,
  prismaAst: Schema,
): Program & { prismaAst: Schema } {
  const lines = code.split(/\r?\n/);
  const lastLineIndex = lines.length - 1;
  const lastCol = lines[lastLineIndex]?.length || 0;

  const comments = prismaAst.list
    .filter(line => line.type === 'comment' || (line as any).properties)
    .map(line =>
      line.type === 'comment' ?
        line
      : (line as any).properties.filter((prop: any) => prop.type === 'comment'),
    )
    .flat()
    .filter(line => (line as any).location)
    .map(comment => comment as Comment & { location: CstNodeLocation })
    .filter(
      line =>
        line.text.startsWith('///') &&
        line.location.startLine &&
        line.location.endLine &&
        line.location.startColumn &&
        line.location.endColumn,
    )
    .map(comment => {
      const location = comment.location;

      return {
        type: 'Line', // AST comments are always one line
        value: comment.text.slice(3).trim(), // Remove leading '///'
        range: [
          location.startOffset,
          location.endOffset || location.startOffset,
        ],
        loc: {
          start: { line: location.startLine!, column: location.startColumn! },
          end: { line: location.endLine!, column: location.endColumn! },
        },
      } satisfies ESTree.Comment;
    });

  return {
    type: 'Program',
    body: [],
    sourceType: 'module',
    range: [0, code.length],
    loc: {
      start: { line: 1, column: 0 },
      end: { line: lastLineIndex + 1, column: lastCol },
    },
    tokens: [],
    comments,

    // Attach the raw Prisma AST so rules can inspect it directly:
    prismaAst,
  };
}

/**
 * In order to let ESLint’s walker descend the Prisma AST,
 * we provide a visitorKeys map that says:
 *  • Program → prismaAst
 *  • Each “model” node → properties
 *  • Each “field” node → attributes
 *  • Each “attribute” node → args
 */
const visitorKeys = {
  Program: ['prismaAst'],
  schema: ['list'],
  model: ['properties'],
  field: ['attributes'],
  attribute: ['args'],
  enum: ['enumerators', 'attributes'],
  attributeArgument: [],
};

type LintParseResult = ESLintParseResult & {
  services: {
    prismaAst: Schema;
  };
  visitorKeys: typeof visitorKeys;
};

const prismaParser = new PrismaParser({
  nodeLocationTracking: 'full',
});
const prismaVisitorClass = VisitorClassFactory(prismaParser);
const prismaVisitor = new prismaVisitorClass();

export function parseForESLint(
  code: string,
  options: ParserOptions,
): LintParseResult {
  try {
    const prismaAst = getSchema(code, {
      parser: prismaParser,
      visitor: prismaVisitor,
    });

    return {
      ast: buildESTreeProgram(code, prismaAst),
      services: {
        prismaAst,
      },
      visitorKeys,
    };
  } catch (error) {
    if (error instanceof Error) {
      error.message = `[prisma-eslint-parser] ${error.message}`;
    }
    if (isRecognitionException(error as IRecognitionException)) {
      const err = error as IRecognitionException;
      const token = err.token;
      throw {
        index: token.startOffset,
        lineNumber: token.startLine,
        column: token.startColumn,
        message: err.message,
      };
    }
    throw error;
  }
}

export const parser = {
  parseForESLint,
  meta,
};
