import { generateApolloClient } from '@deep-foundation/hasura/client';
import Debug from 'debug';
import { up as upTable, down as downTable } from '@deep-foundation/materialized-path/table';
import { up as upRels, down as downRels } from '@deep-foundation/materialized-path/relationships';
import { up as upPerms, down as downPerms } from '@deep-foundation/materialized-path/permissions';
import { Trigger } from '@deep-foundation/materialized-path/trigger';
import { SCHEMA, TABLE_NAME as LINKS_TABLE_NAME } from './1616701513782-links';
import { generatePermissionWhere, permissions } from '../imports/permission';
import { sql } from '@deep-foundation/hasura/sql';
import { GLOBAL_ID_ANY, GLOBAL_ID_DELETE, GLOBAL_ID_INSERT, GLOBAL_ID_SELECT, GLOBAL_ID_UPDATE } from '../imports/global-ids';
import { HasuraApi } from '@deep-foundation/hasura/api';

const debug = Debug('deeplinks:migrations:materialized-path');

const client = generateApolloClient({
  path: `${process.env.MIGRATIONS_HASURA_PATH}/v1/graphql`,
  ssl: !!+process.env.MIGRATIONS_HASURA_SSL,
  secret: process.env.MIGRATIONS_HASURA_SECRET,
});

const api = new HasuraApi({
  path: process.env.MIGRATIONS_HASURA_PATH,
  ssl: !!+process.env.MIGRATIONS_HASURA_SSL,
  secret: process.env.MIGRATIONS_HASURA_SECRET,
});

export const MP_TABLE_NAME = 'mp';

const trigger = Trigger({
  mpTableName: MP_TABLE_NAME,
  graphTableName: LINKS_TABLE_NAME,
  id_type: 'bigint',
  iteratorInsertDeclare: 'groupRow RECORD;',
  iteratorDeleteArgumentSend: 'groupRow',
  iteratorDeleteArgumentGet: 'groupRow RECORD',
  iteratorInsertBegin: `FOR groupRow IN (
    SELECT
    mpGroup.*
    FROM
    ${LINKS_TABLE_NAME} as mpGroup,
    ${LINKS_TABLE_NAME} as mpInclude
    WHERE
    mpInclude."type_id" IN (22,23,24) AND
    mpInclude."to_id" = NEW.type_id AND
    mpInclude."from_id" = mpGroup."id" AND
    mpGroup."type_id" = 21 AND
    ((groupid != 0 AND groupid = mpGroup."id") OR groupid = 0)
    ) LOOP`,
  iteratorInsertEnd: 'END LOOP;',
  groupInsert: 'groupRow."id"',
  iteratorDeleteDeclare: 'groupRow RECORD;',
  iteratorDeleteBegin: `FOR groupRow IN (
    SELECT
    mpGroup.*
    FROM
    ${LINKS_TABLE_NAME} as mpGroup,
    ${LINKS_TABLE_NAME} as mpInclude
    WHERE
    mpInclude."type_id" IN (22,23,24) AND
    mpInclude."to_id" = OLD.type_id AND
    mpInclude."from_id" = mpGroup."id" AND
    mpGroup."type_id" = 21
  ) LOOP`,
  iteratorDeleteEnd: 'END LOOP;',
  groupDelete: 'groupRow."id"',

  // TODO optimize duplicating equal selects

  isAllowSpreadFromCurrent: `EXISTS (SELECT l.* FROM ${LINKS_TABLE_NAME} as l WHERE
    l.type_id IN (22,23,24) AND
    l.from_id = groupRow.id AND
    l.to_id IN (CURRENT.type_id, ${GLOBAL_ID_ANY})
  )`,
  isAllowSpreadCurrentTo: `EXISTS (SELECT l.* FROM ${LINKS_TABLE_NAME} as l WHERE
    l.type_id IN (22,23,24) AND
    l.from_id = groupRow.id AND
    l.to_id IN (CURRENT.type_id, ${GLOBAL_ID_ANY})
  )`,

  isAllowSpreadToCurrent: `EXISTS (SELECT l.* FROM ${LINKS_TABLE_NAME} as l WHERE
    l.type_id = 23 AND
    l.from_id = groupRow.id AND
    l.to_id IN (CURRENT.type_id, ${GLOBAL_ID_ANY})
  )`,
  isAllowSpreadCurrentFrom: `EXISTS (SELECT l.* FROM ${LINKS_TABLE_NAME} as l WHERE
    l.type_id = 23 AND
    l.from_id = groupRow.id AND
    l.to_id IN (CURRENT.type_id, ${GLOBAL_ID_ANY})
  )`,

  isAllowSpreadToInCurrent: `EXISTS (SELECT l.* FROM ${LINKS_TABLE_NAME} as l WHERE
    l.type_id = 22 AND
    l.from_id = groupRow.id AND
    l.to_id IN (flowLink.type_id, ${GLOBAL_ID_ANY})
  )`,
  isAllowSpreadCurrentFromOut: `EXISTS (SELECT l.* FROM ${LINKS_TABLE_NAME} as l WHERE
    l.type_id = 22 AND
    l.from_id = groupRow.id AND
    l.to_id IN (flowLink.type_id, ${GLOBAL_ID_ANY})
  )`,

  isAllowSpreadFromOutCurrent: `EXISTS (SELECT l.* FROM ${LINKS_TABLE_NAME} as l WHERE
    l.type_id = 23 AND
    l.from_id = groupRow.id AND
    l.to_id IN (flowLink.type_id, ${GLOBAL_ID_ANY})
  )`,
  isAllowSpreadCurrentToIn: `EXISTS (SELECT l.* FROM ${LINKS_TABLE_NAME} as l WHERE
    l.type_id = 23 AND
    l.from_id = groupRow.id AND
    l.to_id IN (flowLink.type_id, ${GLOBAL_ID_ANY})
  )`,
});

export const up = async () => {
  debug('up');
  await upTable({
    MP_TABLE: MP_TABLE_NAME, customColumns: '',
    api,
  });
  await upRels({
    SCHEMA,
    MP_TABLE: MP_TABLE_NAME,
    GRAPH_TABLE: LINKS_TABLE_NAME,
    api,
  });
  await permissions(api, MP_TABLE_NAME);
  await permissions(api, LINKS_TABLE_NAME, {
    select: generatePermissionWhere(GLOBAL_ID_SELECT),
    insert: {}, // generatePermissionWhere(GLOBAL_ID_INSERT),
    update: generatePermissionWhere(GLOBAL_ID_UPDATE),
    delete: generatePermissionWhere(GLOBAL_ID_DELETE),

    columns: ['id','from_id','to_id','type_id'],
    computed_fields: ['value'],
  });
  await api.sql(trigger.upFunctionInsertNode());
  await api.sql(trigger.upFunctionDeleteNode());
  await api.sql(trigger.upTriggerDelete());
  await api.sql(trigger.upTriggerInsert());
  await api.sql(sql`CREATE OR REPLACE FUNCTION ${LINKS_TABLE_NAME}__tree_include__insert__function() RETURNS TRIGGER AS $trigger$ BEGIN
    IF (NEW."type_id" IN (22,23,24)) THEN
      PERFORM ${MP_TABLE_NAME}__insert_link__function_core(${LINKS_TABLE_NAME}.*, NEW."from_id")
      FROM ${LINKS_TABLE_NAME} WHERE type_id=NEW."to_id";
    END IF;
    RETURN NEW;
  END; $trigger$ LANGUAGE plpgsql;`);
  await api.sql(sql`CREATE OR REPLACE FUNCTION ${LINKS_TABLE_NAME}__tree_include__delete__function() RETURNS TRIGGER AS $trigger$
  DECLARE groupRow RECORD;
  BEGIN
    -- if delete link - is group include link
    IF (OLD."type_id" IN (22,23,24)) THEN
      SELECT ${LINKS_TABLE_NAME}.* INTO groupRow FROM ${LINKS_TABLE_NAME} WHERE "id"=OLD."from_id" AND "type_id" = 21;
      PERFORM ${MP_TABLE_NAME}__delete_link__function_core(${LINKS_TABLE_NAME}.*, groupRow)
      FROM ${LINKS_TABLE_NAME} WHERE type_id=OLD."to_id";
    END IF;
    RETURN OLD;
  END; $trigger$ LANGUAGE plpgsql;`);
  await api.sql(sql`CREATE TRIGGER ${LINKS_TABLE_NAME}__tree_include__insert__trigger AFTER INSERT ON "${LINKS_TABLE_NAME}" FOR EACH ROW EXECUTE PROCEDURE ${LINKS_TABLE_NAME}__tree_include__insert__function();`);
  await api.sql(sql`CREATE TRIGGER ${LINKS_TABLE_NAME}__tree_include__delete__trigger AFTER DELETE ON "${LINKS_TABLE_NAME}" FOR EACH ROW EXECUTE PROCEDURE ${LINKS_TABLE_NAME}__tree_include__delete__function();`);
};

export const down = async () => {
  debug('down');
  debug('dropInclude');
  await api.sql(sql`DROP FUNCTION IF EXISTS ${LINKS_TABLE_NAME}__tree_include__insert__function CASCADE;`);
  await api.sql(sql`DROP FUNCTION IF EXISTS ${LINKS_TABLE_NAME}__tree_include__delete__function CASCADE;`);
  await api.sql(sql`DROP TRIGGER IF EXISTS ${LINKS_TABLE_NAME}__tree_include__insert__trigger ON "${LINKS_TABLE_NAME}";`);
  await api.sql(sql`DROP TRIGGER IF EXISTS ${LINKS_TABLE_NAME}__tree_include__delete__trigger ON "${LINKS_TABLE_NAME}";`);
  debug('dropRels');
  await downRels({
    MP_TABLE: MP_TABLE_NAME,
    GRAPH_TABLE: LINKS_TABLE_NAME,
    api,
  });
  debug('dropTrigger');
  await api.sql(trigger.downFunctionInsertNode());
  await api.sql(trigger.downFunctionDeleteNode());
  await api.sql(trigger.downTriggerDelete());
  await api.sql(trigger.downTriggerInsert());
  debug('dropTable');
  await downTable({
    MP_TABLE: MP_TABLE_NAME,
    api,
  });
};
