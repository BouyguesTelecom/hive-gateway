import { makeExecutableSchema } from '@graphql-tools/schema';
import { stitchSchemas } from '@graphql-tools/stitch';
import { ExecutionRequest, Executor } from '@graphql-tools/utils';
import { FilterObjectFields } from '@graphql-tools/wrap';
import { graphql } from 'graphql';
import { describe, expect, it } from 'vitest';
import {
  createDefaultExecutor,
  delegateToSchema,
  SubschemaConfig,
} from '../src/index.js';

describe('batch execution', () => {
  it('should batch', async () => {
    const innerSchema = makeExecutableSchema({
      typeDefs: /* GraphQL */ `
        type Query {
          field1: String
          field2: String
        }
      `,
      resolvers: {
        Query: {
          field1: () => 'test1',
          field2: () => 'test2',
        },
      },
    });

    let count = 0;
    const innerSubschemaConfig: SubschemaConfig = {
      schema: innerSchema,
      batch: true,
      executor(...args) {
        count++;
        return createDefaultExecutor(innerSchema)(...args);
      },
    };

    const outerSchema = makeExecutableSchema({
      typeDefs: /* GraphQL */ `
        type Query {
          field1: String
          field2: String
        }
      `,
      resolvers: {
        Query: {
          field1: (_parent, _args, context, info) =>
            delegateToSchema({ schema: innerSubschemaConfig, context, info }),
          field2: (_parent, _args, context, info) =>
            delegateToSchema({ schema: innerSubschemaConfig, context, info }),
        },
      },
    });

    const expectedResult = {
      data: {
        field1: 'test1',
        field2: 'test2',
      },
    };

    const result = await graphql({
      schema: outerSchema,
      source: '{ field1 field2 }',
    });

    expect(result).toEqual(expectedResult);
    expect(count).toBe(1);
  });

  it('should share batching dataloader between subschemas when using a common executor', async () => {
    const innerSchemaA = makeExecutableSchema({
      typeDefs: /* GraphQL */ `
        type Object {
          field1: String
          field2: String
        }
        type Query {
          objectA: Object
        }
      `,
      resolvers: {
        Query: {
          objectA: () => ({}),
        },
        Object: {
          field1: () => 'test1',
          field2: () => 'test2',
        },
      },
    });

    const innerSchemaB = makeExecutableSchema({
      typeDefs: /* GraphQL */ `
        type Object {
          field3: String
        }
        type Query {
          objectB: Object
        }
      `,
      resolvers: {
        Query: {
          objectB: () => ({}),
        },
        Object: {
          field3: () => 'test3',
        },
      },
    });

    let count = 0;
    function executor(req: ExecutionRequest) {
      count++;
      return createDefaultExecutor(innerSchemaA)(req);
    }

    const innerSubschemaConfigA: Array<SubschemaConfig> = [
      {
        schema: innerSchemaA,
        transforms: [
          new FilterObjectFields(
            (typeName, fieldName) =>
              typeName !== 'Object' || fieldName !== 'field2',
          ),
        ],
        merge: {
          Object: {
            fieldName: 'objectA',
            args: () => ({}),
          },
        },
        batch: true,
        executor: executor as Executor,
      },
      {
        schema: innerSchemaA,
        transforms: [
          new FilterObjectFields(
            (typeName, fieldName) =>
              typeName !== 'Object' || fieldName !== 'field1',
          ),
        ],
        merge: {
          Object: {
            fieldName: 'objectA',
            args: () => ({}),
          },
        },
        batch: true,
        executor: executor as Executor,
      },
    ];

    const innerSubschemaConfigB: SubschemaConfig = {
      schema: innerSchemaB,
      merge: {
        Object: {
          fieldName: 'objectB',
          args: () => ({}),
        },
      },
    };

    const query = '{ objectB { field1 field2 field3 } }';

    const expectedResult = {
      data: {
        objectB: {
          field1: 'test1',
          field2: 'test2',
          field3: 'test3',
        },
      },
    };

    const outerSchemaWithSubschemasAsArray = stitchSchemas({
      subschemas: [...innerSubschemaConfigA, innerSubschemaConfigB],
    });

    const resultWhenAsArray = await graphql({
      schema: outerSchemaWithSubschemasAsArray,
      source: query,
    });

    expect(resultWhenAsArray).toEqual(expectedResult);
    expect(count).toBe(1);

    const outerSchemaWithSubschemasSpread = stitchSchemas({
      subschemas: [...innerSubschemaConfigA, innerSubschemaConfigB],
    });

    const resultWhenSpread = await graphql({
      schema: outerSchemaWithSubschemasSpread,
      source: query,
    });

    expect(resultWhenSpread).toEqual(expectedResult);
    expect(count).toBe(2);
  });
});
