# prisma-eslint-parser [![npm version](https://badge.fury.io/js/prisma-eslint-parser.svg)](https://badge.fury.io/js/prisma-eslint-parser)
A Prisma ORM parser for ESLint. 

Lints Prisma schema files (`.prisma`) using ESLint, also allowing you to write custom rules enforcing
custom rules and conventions in your Prisma schemas.

## Installation

```bash
bun i prisma-eslint-parser
# or
npm install prisma-eslint-parser
# or
yarn add prisma-eslint-parser
```

## Usage
In your ESLint configuration file, you can configure the parser to use `prisma-eslint-parser` for any `.prisma` files.
Here's an example of a project that uses typescript-eslint and prisma-eslint-parser:

```javascript
module.exports = {
    extends: ['turbo', 'prettier'],
    plugins: ['custom', '@typescript-eslint'],
    parser: '@typescript-eslint/parser',
    rules: {
        'react/jsx-key': 'off',
        'turbo/no-undeclared-env-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'error',
    },
    overrides: [
        {
            files: ['*.prisma'],
            parser: 'prisma-eslint-parser',
            rules: {
                'custom/prisma-map-naming': 'error',
            },
        },
    ],
};
```

## Writing Custom Rules

This library is using [@MrLeebo/prisma-ast](https://github.com/MrLeebo/prisma-ast) to parse Prisma schemas,
and exposes the services `services.prismaAst` as a context parser service. If you know how to write ESLint rules,
this should be straightforward. Below is an example of a custom rule that ensures that model properties
which are named in camel case are mapped to their same names in snake case.

```ts
/**
 * @fileoverview
 * ESLint rule to ensure that, in a Prisma schema (.prisma),
 * each field’s @map("…") value is the snake_case version of the field name.
 *
 * Now that our parser populates `location` on each AST node and exposes
 * `prismaAst` under Program.prismaAst, we can report directly at attr.location.start.
 */

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Ensure Prisma @map for fields matches snake_case field name',
      category: 'Prisma',
      recommended: false,
    },
    schema: [],
    messages: {
      mismatch:
        'The @map value "{{mapName}}" does not match the expected "{{expected}}" for field "{{fieldName}}".',
    },
  },

  create(context) {
    const services = context.parserServices;
    if (!services || !services.prismaAst) {
      return {};
    }
    const prismaAst = services.prismaAst;

    // Helper: convert camelCase/PascalCase -> snake_case
    function toSnakeCase(fieldName) {
      return fieldName
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, '$1_$2')
        .toLowerCase();
    }

    // Walk through prismaAst.list, pick out model entries
    for (const entry of prismaAst.list || []) {
      if (entry.type !== 'model') {
        continue;
      }
      for (const prop of entry.properties || []) {
        if (prop.type !== 'field') {
          continue;
        }
        const fieldName = prop.name;

        for (const attr of prop.attributes || []) {
          if (attr.name !== 'map') {
            continue;
          }

          // attr.args[0].value is a quoted string literal, e.g. "\"room_session_id\""
          const firstArg = Array.isArray(attr.args) ? attr.args[0] : undefined;
          if (!firstArg || typeof firstArg.value !== 'string') {
            continue;
          }

          const rawLiteral = firstArg.value;
          const mapName =
            rawLiteral.startsWith('"') && rawLiteral.endsWith('"') ?
              rawLiteral.slice(1, -1)
            : rawLiteral;

          const expected = toSnakeCase(fieldName);
          if (mapName !== expected) {
            // Report at the attribute’s start location
            const { startLine, startColumn } = attr.location || {};
            if (startLine !== null && startColumn !== null) {
              context.report({
                loc: {
                  line: startLine,
                  // Chevrotain’s startColumn is 1-based; ESLint wants 0-based
                  column: startColumn - 1,
                },
                messageId: 'mismatch',
                data: { fieldName, mapName, expected },
              });
            }
          }
        }
      }
    }

    return {};
  },
};
```