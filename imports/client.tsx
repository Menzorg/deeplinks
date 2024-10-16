import type { ApolloQueryResult } from '@apollo/client/index.js';
import { Observable, gql, useApolloClient, useQuery, useSubscription } from '@apollo/client/index.js';
import { IApolloClient, generateApolloClient } from '@deep-foundation/hasura/client.js';
import { useLocalStore } from '@deep-foundation/store/local.js';
import atob from 'atob';
import get from 'get-value';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BoolExpCan, BoolExpHandler, BoolExpSelector, BoolExpTree, BoolExpValue, MutationInputLink, MutationInputLinkPlain, MutationInputValue, QueryLink } from './client_types.js';
import { corePckg } from './core.js';
import { debug } from './debug.js';
import { IGenerateMutationBuilder, deleteMutation, generateQuery, generateQueryData, generateSerial, insertMutation, updateMutation } from './gql/index.js';
import { Id, Link, MinilinkCollection, MinilinksResult, useMinilinks, useMinilinksApply, useMinilinksQuery, useMinilinksSubscription } from './minilinks.js';
import { awaitPromise } from './promise.js';
import { useTokenController } from './react-token.js';
import { reserve } from './reserve.js';
import { Traveler as NativeTraveler } from './traveler.js';
const moduleLog = debug.extend('client');

const log = debug.extend('log');
const error = debug.extend('error');

const corePckgIds: { [key: Id]: Id; } = {};
corePckg.data.filter(l => !!l.type).forEach((l, i) => {
  corePckgIds[l.id] = i+1;
});

const random = () => Math.random().toString(36).slice(2, 7);

export const _ids = {
  '@deep-foundation/core': corePckgIds,
};

export const _serialize = {
  links: {
    virtualize: {
      id: ['id', '_id'],
      type_id: ['type_id', '_type_id'],
      from_id: ['from_id', '_from_id'],
      to_id: ['to_id', '_to_id'],
    },
    fields: {
      id: 'number',
      from_id: 'number',
      to_id: 'number',
      type_id: 'number',
      _id: 'number',
      _from_id: 'number',
      _to_id: 'number',
      _type_id: 'number',
    },
    relations: {
      from: 'links',
      to: 'links',
      type: 'links',
      in: 'links',
      out: 'links',
      typed: 'links',
      selected: 'selector',
      selectors: 'selector',
      value: 'value',
      string: 'value',
      number: 'value',
      object: 'value',
      can_rule: 'can',
      can_action: 'can',
      can_object: 'can',
      can_subject: 'can',
      down: 'tree',
      up: 'tree',
      tree: 'tree',
      root: 'tree',
    },
  },
  selector: {
    fields: {
      item_id: 'number',
      selector_id: 'number',
      query_id: 'number',
      selector_include_id: 'number',
    },
    relations: {
      item: 'links',
      selector: 'links',
      query: 'links',
    }
  },
  can: {
    fields: {
      rule_id: 'number',
      action_id: 'number',
      object_id: 'number',
      subject_id: 'number',
    },
    relations: {
      rule: 'links',
      action: 'links',
      object: 'links',
      subject: 'links',
    }
  },
  tree: {
    fields: {
      id: 'number',
      link_id: 'number',
      tree_id: 'number',
      root_id: 'number',
      parent_id: 'number',
      depth: 'number',
      position_id: 'string',
    },
    relations: {
      link: 'links',
      tree: 'links',
      root: 'links',
      parent: 'links',
      by_link: 'tree',
      by_tree: 'tree',
      by_root: 'tree',
      by_parent: 'tree',
      by_position: 'tree',
    }
  },
  value: {
    fields: {
      id: 'number',
      link_id: 'number',
      value: 'value',
    },
    relations: {
      link: 'links',
    },
  },
};

export const _boolExpFields = {
  _and: true,
  _not: true,
  _or: true,
};

export const pathToWhere = (start: (DeepClientStartItem), ...path: DeepClientPathItem[]): any => {
  const pckg = typeof(start) === 'string' ? { type_id: _ids?.['@deep-foundation/core']?.Package, value: start } : { id: start };
  let where: any = pckg;
  for (let p = 0; p < path.length; p++) {
    const item = path[p];
    if (typeof(item) !== 'boolean') {
      const nextWhere = { in: { type_id: _ids?.['@deep-foundation/core']?.Contain, value: item, from: where } };
      where = nextWhere;
    }
  }
  return where;
}

export const serializeWhere = (exp: any, env: string = 'links', unvertualizeId: (id: Id) => Id = defaultUnvertualizeId): any => {
  // if exp is array - map
  if (Object.prototype.toString.call(exp) === '[object Array]') return exp.map((e) => serializeWhere(e, env, unvertualizeId));
  else if (typeof(exp) === 'object') {
    // if object
    const keys = Object.keys(exp);
    const result: any = {};
    // map keys
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      const type = typeof(exp[key]);
      if (typeof(exp[key]) === 'undefined') throw new Error(`${key} === undefined`);
      let setted: any = false;
      const is_id_field = !!~['type_id', 'from_id', 'to_id'].indexOf(key);
      // if this is link
      if (env === 'links') {
        // if field contain primitive type - string/number
        if (key === 'relation') {
          setted = result[key] = exp[key];
        } else if (type === 'string' || type === 'number') {
          if (key === 'value' || key === type) {
            // if field id link.value
            setted = result[type] = { value: { _eq: exp[key] } };
          } else {
            // else just equal
            setted = result[key] = key === 'table' ? exp[key] : { _eq: unvertualizeId(exp[key]) };
          }
        } else if (!_boolExpFields[key] && Object.prototype.toString.call(exp[key]) === '[object Array]') {
          // if field is not boolExp (_and _or _not) but contain array
          // @ts-ignore
          setted = result[key] = serializeWhere(pathToWhere(...exp[key]), 'links', unvertualizeId);
        } else if (key === 'return') {
          setted = result[key] = {};
          for (let r in exp[key]) {
            result[key][r] = serializeWhere(exp[key][r], env, unvertualizeId);
          }
        }
      } else if (env === 'tree') {
        // if field contain primitive type - string/number
        if (type === 'string' || type === 'number') {
          const isId = key === 'link_id' || key === 'tree_id' || key === 'root_id' || key === 'parent_id';
          setted = result[key] = { _eq: isId ? unvertualizeId(exp[key]) : exp[key] };
        } else if (!_boolExpFields[key] && Object.prototype.toString.call(exp[key]) === '[object Array]') {
          // if field is not boolExp (_and _or _not) but contain array
          // @ts-ignore
          setted = result[key] = serializeWhere(pathToWhere(...exp[key]), 'links', unvertualizeId);
        }
      } else if (env === 'value') {
        // if this is value
        if (type === 'string' || type === 'number') {
          setted = result[key] = { _eq: key === 'link_id' ? unvertualizeId(exp[key]) : exp[key] };
        }
      }
      if (type === 'object' && exp[key]?.hasOwnProperty('_type_of') && (
        (env === 'links' && (is_id_field || key === 'id')) ||
        (env === 'selector' && key === 'item_id') ||
        (env === 'can' && !!~['rule_id', 'action_id', 'subject_id', 'object_id',].indexOf(key)) ||
        (env === 'tree' && !!~['link_id', 'tree_id', 'root_id', 'parent_id'].indexOf(key)) ||
        (env === 'value' && key === 'link_id')
      )) {
        // if field is object, and contain _type_od
        const _temp = setted = { _by_item: { path_item_id: { _eq: unvertualizeId(exp[key]._type_of) }, group_id: { _eq: _ids['@deep-foundation/core'].typesTree } } };
        if (key === 'id') {
          result._and = result._and ? [...result._and, _temp] : [_temp];
        } else {
          result[key.slice(0, -3)] = _temp;
        }
      } else if (type === 'object' && exp[key]?.hasOwnProperty('_id') && (
        (env === 'links' && (is_id_field || key === 'id')) ||
        (env === 'selector' && key === 'item_id') ||
        (env === 'can' && !!~['rule_id', 'action_id', 'subject_id', 'object_id',].indexOf(key)) ||
        (env === 'tree' && !!~['link_id', 'tree_id', 'root_id', 'parent_id'].indexOf(key)) ||
        (env === 'value' && key === 'link_id')
      ) && Object.prototype.toString.call(exp[key]._id) === '[object Array]' && exp[key]._id.length >= 1) {
        const root = exp[key]._id[0];
        // if field is object, and contain _type_of
        const _temp = setted = serializeWhere(pathToWhere(typeof(root) === 'number' ? unvertualizeId(root) : root, ...exp[key]._id.slice(1)), 'links', unvertualizeId);
        if (key === 'id') {
          result._and = result._and ? [...result._and, _temp] : [_temp];
        } else {
          result[key.slice(0, -3)] = _temp;
        }
      }
      // if not expected
      if (!setted) {
        const _temp = (
          // if _and _or _not
          _boolExpFields[key]
        ) ? (
          // just parse each item in array
          serializeWhere(exp[key], env, unvertualizeId)
        ) : (
          // if we know context
          _serialize?.[env]?.relations?.[key]
        ) ? (
          // go to this context then
          serializeWhere(exp[key], _serialize?.[env]?.relations?.[key], unvertualizeId)
        ) : (
          // else just stop
          exp[key]
        );
        if (key === '_and') result._and ? result._and.push(..._temp) : result._and = _temp;
        else result[key] = _temp;
      }
    }
    return result;
  } else {
    if (typeof(exp) === 'undefined') throw new Error('undefined in query');
    return exp;
  }
};

const defaultUnvertualizeId = (id: Id): Id => id;

export const serializeQuery = (exp: any, env: string = 'links', unvertualizeId = defaultUnvertualizeId): any => {
  const { limit, order_by, offset, distinct_on, ...where } = exp;
  const result: any = { where: typeof(exp) === 'object' ? Object.prototype.toString.call(exp) === '[object Array]' ? { id: { _in: exp.map(id => unvertualizeId(id)) } } : serializeWhere(where, env, unvertualizeId) : { id: { _eq: unvertualizeId(exp) } } };
  // const result: any = { where: serializeWhere(where, env, unvertualizeId) };
  if (limit) result.limit = limit;
  if (order_by) result.order_by = order_by;
  if (offset) result.offset = offset;
  if (distinct_on) result.distinct_on = distinct_on;
  return result;
}

// https://stackoverflow.com/a/38552302/4448999
export function parseJwt (token): { userId: Id; role: string; roles: string[], [key: string]: any; } {
  var base64Url = token.split('.')[1];
  var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  var jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));

  const parsed = JSON.parse(jsonPayload);
  const { 'x-hasura-allowed-roles': roles, 'x-hasura-default-role': role, 'x-hasura-user-id': userId, ...other } = parsed['https://hasura.io/jwt/claims'] || {};
  return {
    userId: +userId, role, roles,
    ...other,
  };
};

export interface Subscription {
  closed: boolean;
  unsubscribe(): void;
}

export interface Observer<T> {
  start?(subscription: Subscription): any;
  next?(value: T): void;
  error?(errorValue: any): void;
  complete?(): void;
};

export interface DeepClientOptions<L extends Link<Id> = Link<Id>> {
  namespace?: string;

  needConnection?: boolean;

  linkId?: Id;
  token?: string;
  handleAuth?: (linkId?: Id, token?: string) => any;

  deep?: DeepClientInstance<L>;
  self?: DeepClientInstance<L>;

  apolloClient?: IApolloClient<any>;
  minilinks?: MinilinkCollection<any, Link<Id>>;
  table?: string;
  returning?: string;

  selectReturning?: string;
  linksSelectReturning?: string;
  valuesSelectReturning?: string;
  selectorsSelectReturning?: string;
  filesSelectReturning?: string;
  insertReturning?: string;
  updateReturning?: string;
  deleteReturning?: string;

  defaultSelectName?: string;
  defaultInsertName?: string;
  defaultUpdateName?: string;
  defaultDeleteName?: string;

  silent?: boolean;

  unsafe?: any;

  remote?: boolean;
  local?: boolean;
}

export interface DeepClientResult<R> extends ApolloQueryResult<R> {
  error?: any;
  subscribe?: (observer: Observer<any>) => Subscription;
}

export type DeepClientPackageSelector = string;
export type DeepClientPackageContain = string;
export type DeepClientLinkId = Id;
export type DeepClientStartItem = DeepClientPackageSelector | DeepClientLinkId;
export type DeepClientPathItem = DeepClientPackageContain | boolean;

export interface DeepClientInstance<L extends Link<Id> = Link<Id>> {
  namespace?: string;

  linkId?: Id;
  token?: string;
  handleAuth?: (linkId?: Id, token?: string) => any;

  deep: DeepClientInstance<L>;

  apolloClient: IApolloClient<any>;
  minilinks: MinilinksResult<L>;
  table?: string;
  returning?: string;

  selectReturning?: string;
  linksSelectReturning?: string;
  valuesSelectReturning?: string;
  selectorsSelectReturning?: string;
  filesSelectReturning?: string;
  insertReturning?: string;
  updateReturning?: string;
  deleteReturning?: string;

  defaultSelectName?: string;
  defaultInsertName?: string;
  defaultUpdateName?: string;
  defaultDeleteName?: string;

  unsafe?: any;

  stringify(any?: any): string;

  select<TTable extends 'links'|'numbers'|'strings'|'objects'|'can'|'selectors'|'tree'|'handlers', LL = L>(exp: Exp<TTable>, options?: ReadOptions<TTable>): Promise<DeepClientResult<LL[] | number>>;
  subscribe<TTable extends 'links'|'numbers'|'strings'|'objects'|'can'|'selectors'|'tree'|'handlers', LL = L>(exp: Exp<TTable>, options?: ReadOptions<TTable>): Observable<LL[] | number>;

  insert<TTable extends 'links'|'numbers'|'strings'|'objects', LL = L>(objects: InsertObjects<TTable> , options?: WriteOptions<TTable>):Promise<DeepClientResult<{ id }[]>>;

  update<TTable extends 'links'|'numbers'|'strings'|'objects'>(exp: Exp<TTable>, value: UpdateValue<TTable>, options?: WriteOptions<TTable>):Promise<DeepClientResult<{ id }[]>>;

  delete<TTable extends 'links'|'numbers'|'strings'|'objects'>(exp: Exp<TTable>, options?: WriteOptions<TTable>):Promise<DeepClientResult<{ id }[]>>;

  serial(options: AsyncSerialParams): Promise<DeepClientResult<{ id }[]>>;

  reserve<LL = L>(count: number): Promise<Id[]>;

  await(id: Id): Promise<boolean>;


  serializeWhere(exp: any, env?: string): any;
  serializeQuery(exp: any, env?: string): any;
  unvertualizeId(id: Id): Id;

  id(start: DeepClientStartItem | Exp, ...path: DeepClientPathItem[]): Promise<Id>;
  idLocal(start: DeepClientStartItem, ...path: DeepClientPathItem[]): Id;

  guest(options: DeepClientGuestOptions): Promise<DeepClientAuthResult>;

  jwt(options: DeepClientJWTOptions): Promise<DeepClientAuthResult>;

  login(options: DeepClientJWTOptions): Promise<DeepClientAuthResult>;

  logout(): Promise<DeepClientAuthResult>;

  can(objectIds: Id[], subjectIds: Id[], actionIds: Id[]): Promise<boolean>;

  useDeepId: typeof useDeepId;
  useDeepSubscription: typeof useDeepSubscription;
  useDeepQuery: typeof useDeepQuery;
  useMinilinksQuery: (query: Exp) => L[];
  useMinilinksSubscription: (query: Exp) => L[];
  useDeep: typeof useDeep;
  DeepProvider: typeof DeepProvider;
  DeepContext: typeof DeepContext;

  Traveler(links: Link<Id>[]): NativeTraveler;
}

export interface DeepClientAuthResult {
  linkId?: Id;
  token?: string;
  error?: any;
}

export interface DeepClientGuestOptions {
  relogin?: boolean;
}

export interface DeepClientJWTOptions {
  linkId?: Id;
  token?: string;
  relogin?: boolean;
}


export type SelectTable = 'links' | 'numbers' | 'strings' | 'objects' | 'can' | 'selectors' | 'tree' | 'handlers';
export type InsertTable = 'links' | 'numbers' | 'strings' | 'objects';
export type UpdateTable = 'links' | 'numbers' | 'strings' | 'objects' | 'can' | 'selectors' | 'tree' | 'handlers';
export type DeleteTable = 'links' | 'numbers' | 'strings' | 'objects' | 'can' | 'selectors' | 'tree' | 'handlers';

export type OperationType = 'select' | 'insert' | 'update' | 'delete';
export type SerialOperationType = 'insert' | 'update' | 'delete';
export type Table<TOperationType extends OperationType = OperationType> = TOperationType extends 'select'
  ? SelectTable
  : TOperationType extends 'insert'
  ? InsertTable
  : TOperationType extends 'update'
  ? UpdateTable
  : TOperationType extends 'delete'
  ? DeleteTable
  : never;

export type ValueForTable<TTable extends Table> = TTable extends 'numbers'
  ? MutationInputValue<number>
  : TTable extends 'strings'
  ? MutationInputValue<string>
  : TTable extends 'objects'
  ? MutationInputValue<any>
  : MutationInputLink;

export type ExpForTable<TTable extends Table> = TTable extends 'numbers'
  ? BoolExpValue<number>
  : TTable extends 'strings'
  ? BoolExpValue<string>
  : TTable extends 'objects'
  ? BoolExpValue<object>
  : TTable extends 'can'
  ? BoolExpCan
  : TTable extends 'selectors'
  ? BoolExpSelector
  : TTable extends 'tree'
  ? BoolExpTree
  : TTable extends 'handlers'
  ? BoolExpHandler
  : QueryLink;

export type SerialOperationDetails<
  TSerialOperationType extends SerialOperationType,
  TTable extends Table<TSerialOperationType>
> = TSerialOperationType extends 'insert'
  ? {
      objects: ValueForTable<TTable> | ValueForTable<TTable>[];
    }
  : TSerialOperationType extends 'update'
  ? {
      exp: ExpForTable<TTable> | number | number[];
      value: ValueForTable<TTable>;
    }
  : TSerialOperationType extends 'delete'
  ? {
      exp: ExpForTable<TTable> | number | number[];
    }
  : never;

export type SerialOperation<
  TSerialOperationType extends SerialOperationType = SerialOperationType,
  TTable extends Table<TSerialOperationType> = Table<TSerialOperationType>,
> = {
  type: TSerialOperationType;
  table: TTable;
} & SerialOperationDetails<TSerialOperationType, TTable>;

export type DeepSerialOperation = SerialOperation<SerialOperationType, Table<SerialOperationType>>

export type AsyncSerialParams = {
  operations: Array<DeepSerialOperation>;
  name?: string;
  returning?: string;
  silent?: boolean;
};

export function checkAndFillShorts(obj) {
  for (var i in obj) {
      if (!obj.hasOwnProperty(i)) continue;
      if ((typeof obj[i]) == 'object' && obj[i] !== null) {
        if (typeof obj[i] === 'object' && i === 'object' && obj[i]?.data?.value === undefined) { obj[i] = { data: { value: obj[i] } }; continue; }
        if (typeof obj[i] === 'object' && (i === 'to' || i === 'from' || i === 'in' || i === 'out') && obj[i]?.data === undefined) obj[i] = { data: obj[i] };
        checkAndFillShorts(obj[i]);
      }
      else if (i === 'string' && typeof obj[i] === 'string' || i === 'number' && typeof obj[i] === 'number') obj[i] = { data: { value: obj[i] } }; 
  }
}

export function convertDeepInsertToMinilinksApplyAndPatchVirtualIds(deep, objects, table, result: { id?: number; from_id?: number; to_id?: number; type_id?: number; value?: any }[] = [], errors: string[], patch: any = {}): { objects: any; levelIds: any[]; } {
  const levelIds = [];
  if (table === 'links') {
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      let id = o.id;
      if (!id) {
        id = deep.minilinks.virtualCounter--;
        // @ts-ignore
        deep.minilinks?.byId[id]?._id = apply;
      }
      levelIds.push(id);
      const patchRelationIds: any = {};
      if (o?.from) {
        const { objects: objs, levelIds } = convertDeepInsertToMinilinksApplyAndPatchVirtualIds(deep, [o?.from?.data], table, result, errors);
        o.from.data = objs;
        patchRelationIds.from_id = levelIds[0];
      }
      if (o?.to) {
        const { objects: objs, levelIds } = convertDeepInsertToMinilinksApplyAndPatchVirtualIds(deep, [o?.to?.data], table, result, errors);
        o.to.data = objs;
        patchRelationIds.to_id = levelIds[0];
      }
      if (o?.type) {
        const { objects: objs, levelIds } = convertDeepInsertToMinilinksApplyAndPatchVirtualIds(deep, [o?.type?.data], table, result, errors);
        o.type.data = objs;
        patchRelationIds.type_id = levelIds[0];
      }
      if (o?.out) {
        const { objects: objs, levelIds } = convertDeepInsertToMinilinksApplyAndPatchVirtualIds(deep, (o?.out?.data?.length ? o?.out?.data : [o?.out?.data]), table, result, errors, { from_id: id });
        o.out.data = objs;
      }
      if (o?.in) {
        const { objects: objs, levelIds } = convertDeepInsertToMinilinksApplyAndPatchVirtualIds(deep, (o?.in?.data?.length ? o?.in?.data : [o?.in?.data]), table, result, errors, { to_id: id });
        o.in.data = objs;
      }
      if (o?.types) {
        const { objects: objs, levelIds } = convertDeepInsertToMinilinksApplyAndPatchVirtualIds(deep, (o?.types?.data?.length ? o?.types?.data : [o?.types?.data]), table, result, errors, { type_id: id });
        o.types.data = objs;
      }
      if (typeof(o.from_id) === 'number' || typeof(o.from_id) === 'string') {
        if (o.from_id < 0) {
          if (deep.minilinks.virtual[o.from_id]) o.from_id = deep.minilinks.virtual[o.from_id];
          else errors.push(`.from_id=${o.from_id} can't be devertualized, not exists in minilinks.virtual[${o.from_id}]`);
        }
      }
      if (typeof(o.to_id) === 'number' || typeof(o.to_id) === 'string') {
        if (o.to_id < 0) {
          if (deep.minilinks.virtual[o.to_id]) o.to_id = deep.minilinks.virtual[o.to_id];
          else errors.push(`.to_id=${o.to_id} can't be devertualized, not exists in minilinks.virtual[${o.to_id}]`);
        }
      }
      if (typeof(o.type_id) === 'number' || typeof(o.type_id) === 'string') {
        if (o.type_id < 0) {
          if (deep.minilinks.virtual[o.type_id]) o.type_id = deep.minilinks.virtual[o.type_id];
          else errors.push(`.type_id=${o.type_id} can't be devertualized, not exists in minilinks.virtual[${o.type_id}]`);
        }
      }
      result.push({
        id: id, from_id: o.from_id, to_id: o.to_id, type_id: o.type_id,
        value: o.string?.data || o.number?.data || o.object?.data,
        ...patch, ...patchRelationIds
      });
    }
  }
  return { objects: objects.length == 1 ? objects[0] : objects, levelIds };
}

export function convertDeepUpdateToMinilinksApply(ml, _exp, _set, table, toUpdate: { id?: number; from_id?: number; to_id?: number; type_id?: number; value?: any }[] = []): void {
  if (table === 'links') {
    try {
      const founded = ml.query(_exp);
      for (let f of founded) {
        toUpdate.push({
          id: f.id, from_id: f.from_id, to_id: f.to_id, type_id: f.type_id,
          value: f.value,
          ..._set
        });
      }
    } catch(e) {}
  } else if (table === 'strings' || table === 'numbers' || table === 'objects') {
    const key = table.slice(0, -1);
    const founded = ml.query({ [key]: _exp });
    for (let f of founded) {
      toUpdate.push({
        id: f.id, from_id: f.from_id, to_id: f.to_id, type_id: f.type_id,
        value: { ...f?.value, value: _set.value },
      });
    }
  }
}

export function convertDeepDeleteToMinilinksApply(ml, _exp, table, toDelete: number[] = [], toUpdate: { id?: number; from_id?: number; to_id?: number; type_id?: number; value?: any }[] = []): void {
  if (table === 'links') {
    try {
      const founded = ml.query(_exp);
      toDelete.push(...founded.map(l => l.id));
    } catch(e) {}
  } else if (table === 'strings' || table === 'numbers' || table === 'objects') {
    const key = table.slice(0, -1);
    const founded = ml.query({ [key]: _exp });
    toUpdate.push(...founded.map(o => ({
      id: o.id, from_id: o.from_id, to_id: o.to_id, type_id: o.type_id,
    })));
  }
}

export class DeepClient<L extends Link<Id> = Link<Id>> implements DeepClientInstance<L> {
  static resolveDependency?: (path: string) => Promise<any>

  useDeep = useDeep;
  DeepProvider = DeepProvider;
  DeepContext = DeepContext;

  namespace?: string;

  linkId?: Id;
  token?: string;
  handleAuth?: (linkId?: Id, token?: string) => any;

  deep: DeepClientInstance<L>;

  client: IApolloClient<any>;
  apolloClient: IApolloClient<any>;
  minilinks: MinilinksResult<L>;
  table?: string;
  returning?: string;

  selectReturning?: string;
  linksSelectReturning?: string;
  valuesSelectReturning?: string;
  selectorsSelectReturning?: string;
  filesSelectReturning?: string;
  insertReturning?: string;
  updateReturning?: string;
  deleteReturning?: string;

  defaultSelectName?: string;
  defaultInsertName?: string;
  defaultUpdateName?: string;
  defaultDeleteName?: string;

  silent: boolean;

  unsafe?: any;

  useDeepId: typeof useDeepId;
  useDeepSubscription: typeof useDeepSubscription;
  useDeepQuery: typeof useDeepQuery;
  useMinilinksQuery: (query: Exp) => L[];
  useMinilinksSubscription: (query: Exp) => L[];
  local?: boolean;
  remote?: boolean;

  unvertualizeId: (id: Id) => Id;

  _silent(options: Partial<{ silent?: boolean }> = {}): boolean {
    return typeof(options.silent) === 'boolean' ? options.silent : this.silent;
  }

  constructor(options: DeepClientOptions<L>) {
    this.namespace = options?.namespace || randomName();

    this.local = typeof(options?.local) === 'boolean' ? options?.local : true;
    this.remote = typeof(options?.remote) === 'boolean' ? options?.remote : true;

    if (options?.needConnection != false) {
      this.deep = options?.deep;
      this.apolloClient = options?.apolloClient;
      this.token = options?.token;
      this.client = this.apolloClient;
      this.table = options.table || 'links';

      if (this.deep && !this.apolloClient) {
        const token = this.token ?? this.deep.token;
        if (!token) {
          throw new Error('token for apolloClient is invalid or not provided');
        }
        this.apolloClient = generateApolloClient({
          // @ts-ignore
          path: this.deep.apolloClient?.path,
          // @ts-ignore
          ssl: this.deep.apolloClient?.ssl,
          token: token,
        });
      }

      if (!this.apolloClient) throw new Error('apolloClient is invalid or not provided');

      if (this.token) {
        const decoded = parseJwt(this.token);
        const linkId = decoded?.userId;
        if (!linkId){
          throw new Error(`Unable to parse linkId from jwt token.`);
        }
        if (options.linkId && options.linkId !== linkId){
          throw new Error(`linkId (${linkId}) parsed from jwt token is not the same as linkId passed via options (${options.linkId}).`);
        }
        this.linkId = linkId;
      } else {
        this.linkId = options.linkId;
      }
    }

    // @ts-ignore
    this.minilinks = options.minilinks || new MinilinkCollection();
    this.unvertualizeId = (id: Id): Id => {
      // @ts-ignore
      return this.minilinks.virtual.hasOwnProperty(id) ? this.minilinks.virtual[id] : id;
    };

    this.linksSelectReturning = options.linksSelectReturning || options.selectReturning || 'id type_id from_id to_id value';
    this.selectReturning = options.selectReturning || this.linksSelectReturning;
    this.valuesSelectReturning = options.valuesSelectReturning || 'id link_id value';
    this.selectorsSelectReturning = options.selectorsSelectReturning ||'item_id selector_id';
    this.filesSelectReturning = options.filesSelectReturning ||'id link_id name mimeType';
    this.insertReturning = options.insertReturning || 'id';
    this.updateReturning = options.updateReturning || 'id';
    this.deleteReturning = options.deleteReturning || 'id';

    this.defaultSelectName = options.defaultSelectName || 'SELECT';
    this.defaultInsertName = options.defaultInsertName || 'INSERT';
    this.defaultUpdateName = options.defaultUpdateName || 'UPDATE';
    this.defaultDeleteName = options.defaultDeleteName || 'DELETE';
    
    this.silent = options.silent || false;

    this.unsafe = options.unsafe || {};

    this.handleAuth = options?.handleAuth || options?.deep?.handleAuth;
    // @ts-ignore
    this.minilinks = options.minilinks || new MinilinkCollection();

    this._generateHooks(this);
  }

  _generateHooks(deep) {
    // @ts-ignore
    this.useDeepId = (start: DeepClientStartItem | QueryLink, ...path: DeepClientPathItem[]): { data: Id; loading: boolean; error?: any } => _useDeepId(deep, start, ...path);
    // @ts-ignore
    this.useDeepSubscription = (query: Exp, options?: Options) => useDeepSubscription(query, { ...(options || {}), deep: deep });
    // @ts-ignore
    this.useDeepQuery = (query: Exp, options?: Options) => useDeepQuery(query, { ...(options || {}), deep: deep });
    // @ts-ignore
    this.useMinilinksQuery = (query: Exp) => useMinilinksQuery(deep.minilinks, query);
    // @ts-ignore
    this.useMinilinksSubscription = (query: Exp) => useMinilinksSubscription(deep.minilinks, query)
  }

  stringify(any?: any): string {
    if (typeof(any) === 'string') {
      let json;
      try { json = JSON.parse(any); } catch(e) {}
      return json ? JSON.stringify(json, null, 2) : any.toString();
    } else if (typeof(any) === 'object') {
      return JSON.stringify(any, null, 2);
    }
    return any;
  }

  serializeQuery(exp, env?: string) { return serializeQuery(exp, env, this.unvertualizeId); }
  serializeWhere(exp, env?: string) { return serializeWhere(exp, env, this.unvertualizeId); } 

  _generateQuery<TTable extends 'links'|'numbers'|'strings'|'objects'|'can'|'selectors'|'tree'|'handlers'>(exp: Exp<TTable>, options: Options<TTable>) {
    const query = serializeQuery(exp, options?.table || 'links', this.unvertualizeId);
    const table = options?.table || this.table;
    const returning = options?.returning ?? 
    (table === 'links' ? this.linksSelectReturning :
    ['strings', 'numbers', 'objects'].includes(table) ? this.valuesSelectReturning :
    table === 'selectors' ? this.selectorsSelectReturning :
    table === 'files' ? this.filesSelectReturning : `id`);
    const tableNamePostfix = options?.tableNamePostfix;
    const aggregate = options?.aggregate;

    const variables = options?.variables;
    const name = options?.name || this.defaultSelectName;

    const queryData = generateQueryData({
      tableName: table,
      tableNamePostfix: tableNamePostfix || aggregate ? '_aggregate' : '',
      returning: aggregate ? `aggregate { ${aggregate} }` : returning,
      variables: {
        ...variables,
        ...query,
      },
    });
    return {
      query: generateQuery({
        operation: options?.subscription ? 'subscription' : 'query',
        queries: [
          queryData,
        ],
        name: name,
      }),
      queryData,
    };
  }

  _generateResult<TTable extends 'links'|'numbers'|'strings'|'objects'|'can'|'selectors'|'tree'|'handlers'>(exp: Exp<TTable>, options: Options<TTable>, data): any[] | Promise<any[]> {
    return data;
  }

  /**
   * Gets a value from the database. By default gets a link from the links table
   * @param exp A filter expression to filter the objects to get
   * @param options An object with options for the select operation
   * @returns A promise that resolves to the selected object or an array of selected objects with the fields configured by {@link options.returning} which is by default 'id'
   * 
   * @example
   * #### Select by id
   * ``` 
   * await deep.select({
   *   id: deep.linkId
   * })
   * ```
   * 
   * #### Select by type_id
   * ``` 
   * await deep.select({
   *   type_id: {
   *     _id: ["@deep-foundation/core", "User"]
   *   }
   * })
   * ```
   * 
   * #### Select by from_id
   * ``` 
   * await deep.select({
   *   from_id: deep.linkId
   * })
   * ```
   * 
   * #### Select by to_id
   * ``` 
   * await deep.select({
   *   to_id: deep.linkId
   * })
   * ```
   * 
   * #### Select by string value
   * ``` 
   * await deep.select({
   *   string: {
   *     value: {
   *       _eq: "MyString"
   *     }
   *   }
   * })
   * ```
   * 
   * #### Select by number value
   * ``` 
   * await deep.select({
   *   number: {
   *     value: {
   *       _eq: 888
   *     }
   *   }
   * })
   * ```
   * 
   * #### Select by object value
   * ``` 
   * await deep.select({
   *   object: {
   *     value: {
   *       _eq: {
   *         myFieldKey: "myFieldValue"
   *       }
   *     }
   *   }
   * })
   * ```
   */
  async select<TTable extends 'links'|'numbers'|'strings'|'objects'|'can'|'selectors'|'tree'|'handlers', LL = L>(exp: Exp<TTable>, options?: ReadOptions<TTable>): Promise<DeepClientResult<LL[]>> {
    if (!exp) return { error: { message: '!exp' }, data: undefined, loading: false, networkStatus: undefined };
    const aggregate = options?.aggregate;
    const queryData = this._generateQuery(exp, options);
    try {
      const q = await this.apolloClient.query({ query: queryData.query.query, variables: queryData?.query?.variables });
      return { ...q, data: aggregate ? (q)?.data?.q0?.aggregate?.[aggregate] : await this._generateResult(exp, options, q?.data?.q0) };
    } catch (e) {
      console.log(queryData);
      throw new Error(`DeepClient Select Error: ${e.message}`, { cause: e });
    }
  };

  /**
   * Subscribes to data in the database
   * @example
   * ```
   * deep.subscribe({ up: { link_id: deep.linkId } }).subscribe({ next: (links) => {}, error: (err) => {} });
   * ```
   */
  subscribe<TTable extends 'links'|'numbers'|'strings'|'objects'|'can'|'selectors'|'tree'|'handlers', LL = L>(exp: Exp<TTable>, options?: ReadOptions<TTable>): Observable<LL[]> {
    if (!exp) return new Observable((observer) => observer.error('!exp'));
    const aggregate = options?.aggregate;
    const queryData = this._generateQuery(exp, { ...options, subscription: true });

    try {
      const apolloObservable = this.apolloClient.subscribe({ query: queryData.query.query, variables: queryData?.query?.variables });
      const observable = new Observable((observer) => {
        const subscription = apolloObservable.subscribe({
          next: async (data: any) => {
            observer.next(aggregate ? data?.q0?.aggregate?.[aggregate] : 
            await this._generateResult(exp, options, data?.q0));
          },
          error: (error) => observer.error(error),
        });
        return () => subscription.unsubscribe();
      });

    // @ts-ignore
      return observable;
    } catch (e) {
      throw new Error(`DeepClient Subscription Error: ${e.message}`, { cause: e });
    }
  };

  /**
   * Inserts a value into the database. By default inserts a link to the links table
   * @param objects An object or array of objects to insert to the database
   * @param options An object with options for the insert operation
   * @returns A promise that resolves to the inserted object or an array of inserted objects with the fields configured by {@link options.returning} which is by default 'id'
   * 
   * @remarks
   * If a link already has value you should update its value, not insert 
   * 
   * @example
   * #### Insert Type
   * ``` 
   * await deep.insert({
   *   type_id: await deep.id("@deep-foundation/core", "Type")
   * })
   * ```
   * In this case instances of your type will not have from and to
   * 
   * #### Insert Type from Package to User
   * ``` 
   * await deep.insert({
   *   type_id: await deep.id("@deep-foundation/core", "Type"),
   *   from_id: await deep.id("@deep-foundation/core", "Package"),
   *   to_id: await deep.id("@deep-foundation/core", "User")
   * })
   * ```
   * In this case instances of your type will must go from instances of Package to instances of User
   * 
   * #### Insert Type with from Any to Any
   * ``` 
   * await deep.insert({
   *   type_id: await deep.id("@deep-foundation/core", "Type"),
   *   from_id: await deep.id("@deep-foundation/core", "Any"),
   *   to_id: await deep.id("@deep-foundation/core", "Any")
   * })
   * ```
   * In this case instances of your type may go from instances of any link to instances of any link without restrictions
   * 
   * #### Insert Type with from Package to Any
   * ``` 
   * await deep.insert({
   *   type_id: await deep.id("@deep-foundation/core", "Type"),
   *   from_id: await deep.id("@deep-foundation/core", "Package"),
   *   to_id: await deep.id("@deep-foundation/core", "Any")
   * })
   * ```
   * In this case instances of your type may go from instances of Package to instances of any link without restrictions
   * 
   * #### Insert Type with from Any to Package
   * ``` 
   * await deep.insert({
   *   type_id: await deep.id("@deep-foundation/core", "Type"),
   *   from_id: await deep.id("@deep-foundation/core", "Any"),
   *   to_id: await deep.id("@deep-foundation/core", "Package")
   * })
   * ```
   * In this case instances of your type may go from instances of any link without restrictions to instances of Package 
   * 
   * #### Insert string
   * ``` 
   * await deep.insert({
   *   link_id: 888,
   *   value: 'MyString'
   * }, {
   *   table: 'strings'
   * })
   * ```
   * Note: If a link already has value you should update its value, not insert 
   * 
   * #### Insert number
   * ``` 
   * await deep.insert({
   *   link_id: 888,
   *   value: 888
   * }, {
   *   table: 'numbers'
   * })
   * ```
   * Note: If a link already has value you should update its value, not insert 
   * 
   * #### Insert object
   * ``` 
   * await deep.insert({
   *   link_id: 888,
   *   value: {
   *     myFieldName: 'myFieldValue'
   *   }
   * }, {
   *   table: 'objects'
   * })
   * ```
   * Note: If a link already has value you should update its value, not insert 
   */
  async insert<TTable extends 'links'|'numbers'|'strings'|'objects', LL = L>(objects: InsertObjects<TTable>, options?: WriteOptions<TTable>):Promise<DeepClientResult<{ id }[]>> {
    let _objects = Object.prototype.toString.call(objects) === '[object Array]' ? objects : [objects];
    checkAndFillShorts(_objects);

    const { local, remote } = { local: this.local, remote: this.remote, ...options };

    const table = options?.table || this.table;
    const returning = options?.returning || this.insertReturning;
    const variables = options?.variables;
    const name = options?.name || this.defaultInsertName;
    let q: any = {};

    const toApply: any = [];
    if (this.minilinks && local !== false) {
      const errors = [];
      const { objects: __objects } = convertDeepInsertToMinilinksApplyAndPatchVirtualIds(this, _objects, table, toApply, errors) as any;
      _objects = __objects;
      if (errors.length) console.log('convertDeepInsertToMinilinksApplyAndPatchVirtualIds', 'errors', errors);
      this.minilinks.add(toApply);
    }

    if (remote !== false) {
      try {
        q = await this.apolloClient.mutate(generateSerial({
          actions: [insertMutation(table, { ...variables, objects: _objects }, { tableName: table, operation: 'insert', returning })],
          name: name,
        }));
      } catch(e) {
        const sqlError = e?.graphQLErrors?.[0]?.extensions?.internal?.error;
        if (sqlError?.message) e.message = sqlError.message;
        if (!this._silent(options)) throw new Error(`DeepClient Insert Error: ${e.message}`, { cause: e })
        return { ...q, data: (q)?.data?.m0?.returning, error: e };
      }
    } else {
      return { ...q, data: toApply.map(l => l.id), loading: false };
    }
  
    // @ts-ignore
    return { ...q, data: (q)?.data?.m0?.returning };
  }; 

  /**
   * Updates a value in the database. By default updates a link in the links table
   * @param exp An expression to filter the objects to update
   * @param value A value to update the objects with
   * @param options An object with options for the update operation
   * @returns A promise that resolves to the updated object or an array of updated objects with the fields configured by {@link options.returning} which is by default 'id'
   * 
   * @example
   * #### Update from by id
   * ``` 
   * await deep.update({
   *   id: 888
   * }, {
   *   from_id: 1
   * })
   * ```
   * In this case from_id will be updated to 1 for link with id 888
   * 
   * #### Update to by id
   * ``` 
   * await deep.update({
   *   id: 888
   * }, {
   *   to_id: 1
   * })
   * ```
   * In this case to_id will be updated to 1 for link with id 888
   * 
   * #### Update string value by link id
   * ``` 
   * await deep.update(
   *   {
   *     link_id: 888
   *   },
   *   {
   *     value: "MyStringValue"
   *   },
   *   {
   *     table: 'strings'
   *   }
   * )
   * ```
   * In this case string value will be updated to "MyStringValue" for link with id 888
   * 
   * #### Update number value by link id
   * ``` 
   * await deep.update(
   *   {
   *     link_id: 888
   *   },
   *   {
   *     value: 888
   *   },
   *   {
   *     table: 'numbers'
   *   }
   * )
   * ```
   * In this case number value will be updated to 888 for link with id 888
   * 
   * #### Update object value by link id
   * ``` 
   * await deep.update(
   *   {
   *     link_id: 888
   *   },
   *   {
   *     value: {
   *       myFieldName: "myFieldValue"
   *     }
   *   },
   *   {
   *     table: 'numbers'
   *   }
   * )
   * ```
   * In this case number value will be updated to { myFieldName: "myFieldValue" } for link with id 888
   */
  async update<TTable extends 'links'|'numbers'|'strings'|'objects'>(exp: Exp<TTable>, value: UpdateValue<TTable>, options?: WriteOptions<TTable>):Promise<DeepClientResult<{ id }[]>> {
    if (exp === null) return this.insert( [value], options);
    if (value === null) return this.delete( exp, options );

    const { local, remote } = { local: this.local, remote: this.remote, ...options };
  
    const query = serializeQuery(exp, options?.table === this.table || !options?.table ? 'links' : 'value', this.unvertualizeId);
    const table = options?.table || this.table;

    const toUpdate: any = [];
    if (this.minilinks && local !== false) {
      convertDeepUpdateToMinilinksApply(this.minilinks, exp, value, table, toUpdate);
      this.minilinks.update(toUpdate);
    }

    const returning = options?.returning || this.updateReturning;
    const variables = options?.variables;
    const name = options?.name || this.defaultUpdateName;
    let q;
    if (remote !== false) {
      try {
        q = await this.apolloClient.mutate(generateSerial({
          actions: [updateMutation(table, { ...variables, ...query, _set: value }, { tableName: table, operation: 'update', returning })],
          name: name,
        }));
      } catch(e) {
        const sqlError = e?.graphQLErrors?.[0]?.extensions?.internal?.error;
        if (sqlError?.message) e.message = sqlError.message;
        if (!this._silent(options)) throw new Error(`DeepClient Update Error: ${e.message}`, { cause: e });
        return { ...q, data: (q)?.data?.m0?.returning, error: e };
      }
    } else {
      return { ...q, data: toUpdate.map(l => l.id), loading: false };
    }

    // @ts-ignore
    return { ...q, data: (q)?.data?.m0?.returning };
  };

  /**
   * Deletes a value in the database. By default deletes a link in the links table
   * @param exp An expression to filter the objects to delete
   * @param options An object with options for the delete operation
   * @returns A promise that resolves to the deleted object or an array of deleted objects with the fields configured by {@link options.returning} which is by default 'id'
   * 
   * @example
   * #### Delete by id
   * ``` 
   * await deep.delete({
   *   id: 888
   * })
   * ```
   * In this case the link with id 888 will be deleted
   * 
   * #### Delete by type_id
   * ``` 
   * await deep.delete({
   *   type_id: 888
   * })
   * ```
   * In this case all the links with type_id 888 will be deleted
   * 
   * #### Delete by from_id
   * ``` 
   * await deep.delete({
   *   from_id: 888
   * })
   * ```
   * In this case all the links with from_id 888 will be deleted
   * 
   * #### Delete by to_id
   * ``` 
   * await deep.delete({
   *   to_id: 888
   * })
   * ```
   * In this case all the links with to_id 888 will be deleted
   * 
   * #### Delete by string value
   * ``` 
   * await deep.delete({
   *   string: {
   *     value: {
   *       _eq: 'MyString'
   *     }
   *   }
   * })
   * ```
   * In this case all the links with string value 'MyString' will be deleted
   * 
   * #### Delete by number value
   * ``` 
   * await deep.delete({
   *   number: {
   *     value: {
   *       _eq: 888
   *     }
   *   }
   * })
   * ```
   * In this case all the links with number value 888 will be deleted
   * 
   * #### Delete by object value
   * ``` 
   * await deep.delete({
   *   object: {
   *     value: {
   *       _eq: {
   *         myFieldKey: "myFieldValue"
   *       }
   *     }
   *   }
   * })
   * ```
   * In this case all the links with object value { myFieldName: "myFieldValue" } will be deleted
   * 
   * #### Delete string value by link id
   * ``` 
   * await deep.delete({
   *   link_id: 888
   * }, {
   *   table: 'strings'
   * })
   * ```
   * In this case string value of a link with id 888 will be deleted
   * 
   * #### Delete number value by link id
   * ``` 
   * await deep.delete({
   *   link_id: 888
   * }, {
   *   table: 'numbers'
   * })
   * ```
   * In this case number value of a link with id 888 will be deleted
   * 
   * #### Delete object value by link id
   * ``` 
   * await deep.delete({
   *   link_id: 888
   * }, {
   *   table: 'objects'
   * })
   * ```
   * In this case object value of a link with id 888 will be deleted
   */
  async delete<TTable extends 'links'|'numbers'|'strings'|'objects'>(exp: Exp<TTable>, options?: WriteOptions<TTable>):Promise<DeepClientResult<{ id }[]>> {
    if (!exp) throw new Error('!exp');
    const { local, remote } = { local: this.local, remote: this.remote, ...options };

    const query = serializeQuery(exp, options?.table === this.table || !options?.table ? 'links' : 'value', this.unvertualizeId);
    const table = options?.table || this.table;
    const returning = options?.returning || this.deleteReturning;
    const variables = options?.variables;
    const name = options?.name || this.defaultDeleteName;
    let q;

    const toDelete: any = [];
    const toUpdate: any = [];
    if (this.minilinks && local !== false) {
      convertDeepDeleteToMinilinksApply(this.minilinks, exp, table, toDelete, toUpdate);
      this.minilinks.update(toUpdate);
      this.minilinks.remove(toDelete);
    }

    if (remote !== false) {
      try {
        q = await this.apolloClient.mutate(generateSerial({
          actions: [deleteMutation(table, { ...variables, ...query, returning }, { tableName: table, operation: 'delete', returning })],
          name: name,
        }));
        // @ts-ignore
      } catch(e) {
        const sqlError = e?.graphQLErrors?.[0]?.extensions?.internal?.error;
        if (sqlError?.message) e.message = sqlError.message;
        if (!this._silent(options)) throw new Error(`DeepClient Delete Error: ${e.message}`, { cause: e });
        return { ...q, data: (q)?.data?.m0?.returning, error: e };
      }
    } else {
      return { ...q, data: toDelete.map(l => l.id), loading: false };
    }

    return { ...q, data: (q)?.data?.m0?.returning };
  };

  /**
   * Performs write operations to the database in a serial manner
   * @param options An object with data for the serial operation
   * @returns A promise that resolves to the deleted object or an array of deleted objects with the fields configured by {@link options.returning} which is by default 'id'
   */
  async serial(options: AsyncSerialParams): Promise<DeepClientResult<{ id: Id }[]>> {
    const {
      name, operations, returning, silent
    } = options;
    // @ts-ignore
    let operationsGroupedByTypeAndTable: Record<SerialOperationType, Record<Table, Array<SerialOperation>>> = {};
    operationsGroupedByTypeAndTable = operations.reduce((acc, operation) => {
      if (!acc[operation.type]) {
        // @ts-ignore
        acc[operation.type] = {}
      }
      if (!acc[operation.type][operation.table]) {
        acc[operation.type][operation.table] = []
      }
      acc[operation.type][operation.table].push(operation);
      return acc
    }, operationsGroupedByTypeAndTable);
    let serialActions: Array<IGenerateMutationBuilder> = [];
    Object.keys(operationsGroupedByTypeAndTable).map((operationType: SerialOperationType) => {
      const operationsGroupedByTable = operationsGroupedByTypeAndTable[operationType];
      Object.keys(operationsGroupedByTable).map((table: Table<typeof operationType>) => {
        const operations = operationsGroupedByTable[table];
        if (operationType === 'insert') {
          const insertOperations = operations as Array<SerialOperation<'insert', Table<'insert'>>>;
          const serialAction: IGenerateMutationBuilder = insertMutation(table, { objects: insertOperations.map(operation => Array.isArray(operation.objects) ? operation.objects : [operation.objects]).flat() }, { tableName: table, operation: operationType, returning })
          serialActions.push(serialAction);
        } else if (operationType === 'update') {
          const updateOperations = operations as Array<SerialOperation<'update', Table<'update'>>>;
          const newSerialActions: IGenerateMutationBuilder[] = updateOperations.map(operation => {
            const exp = operation.exp;
            const value = operation.value;
            const query = serializeQuery(exp, table === this.table || !table ? 'links' : 'value', this.unvertualizeId);
            return updateMutation(table, {...query, _set: value }, { tableName: table, operation: operationType ,returning})
          })
          serialActions = [...serialActions, ...newSerialActions];
        } else if (operationType === 'delete') {
          const deleteOperations = operations as Array<SerialOperation<'delete', Table<'delete'>>>;;
          const newSerialActions: IGenerateMutationBuilder[] = deleteOperations.map(operation => {
            const exp = operation.exp;
            const query = serializeQuery(exp, table === this.table || !table ? 'links' : 'value', this.unvertualizeId);
            return deleteMutation(table, { ...query }, { tableName: table, operation: operationType, returning })
          })
          serialActions = [...serialActions, ...newSerialActions];
        }
      })
    })

    let result;
    try {
      result = await this.apolloClient.mutate(generateSerial({
        actions: serialActions,
        name: name ?? 'Name',
      }))
      // @ts-ignore
    } catch (e) {
      const sqlError = e?.graphQLErrors?.[0]?.extensions?.internal?.error;
      if (sqlError?.message) e.message = sqlError.message;
      if (!silent) throw new Error(`DeepClient Serial Error: ${e.message}`, { cause: e });
      return { ...result, data: (result)?.data?.m0?.returning, error: e };
    }
    // @ts-ignore
    return { ...result, data: (result)?.data && Object.values((result)?.data).flatMap(m => m.returning)};
  };

  reserve<LL = L>(count: number): Promise<Id[]> {
    return reserve({ count, client: this.apolloClient });
  };

  /**
   * Await for a promise
   * @param id Id of a link which is processed by a handler
   * @param options An object with options for the await operation
   * @returns A promise that resolves to the result of the awaited promise
   * 
   * @example
   * #### Await a promise of npm-packager
   * Let us imagine you have published a package and want to programatically wait until it is published or failed to publish
   * ```
   * await deep.await(
   *   await deep.id('my-package-name')
   * )
   * ```
   * In this case you will await all the promises for 'my-package-name' link
   */
  async await(id: Id, options: { results: boolean } = { results: false } ): Promise<any> {
    return awaitPromise({
      id, client: this.apolloClient,
      Then: await this.id('@deep-foundation/core', 'Then'),
      Promise: await this.id('@deep-foundation/core', 'Promise'),
      Resolved: await this.id('@deep-foundation/core', 'Resolved'),
      Rejected: await this.id('@deep-foundation/core', 'Rejected'),
      Results: options.results
    });
  };

  /**
   * Find id of a link by link name or id and contain values (names) as path items
   * @param start A name or id of a link
   * @param path Contain values (names) as path items
   * @returns A promise that resolves to the id of the link
   * 
   * @example
   * #### Get Core Package Link Id
   * ```
   * const corePackageLinkId = await deep.id("@deep-foundation/core")
   * ```
   * 
   * #### Get User Type Link Id From Core Package
   * ```
   * const userTypeLinkId = await deep.id("@deep-foundation/core", "User")
   * ```
   * 
   * #### Get the link called "My Nested Link Name" contained in the link called "My Link Name" contained the current user
   * ```
   * const myLinkId = await deep.id(deep.linkId, 'My Link Name', 'My Nested Link Name')
   * ```
   * 
   * #### Get Admin Link Id
   * ```
   * const adminLinkId = await deep.id("deep", "admin")
   * ```
   */
  async id(start: DeepClientStartItem | QueryLink, ...path: DeepClientPathItem[]): Promise<number> {
    if (typeof(start) === 'object') {
      return ((await this.select(start)) as any)?.data?.[0]?.id;
    }
    if (_ids?.[start]?.[path[0]]) {
      return _ids[start][path[0]];
    }
    const q = await this.select(pathToWhere(start, ...path));
    if (q.error) {
      throw q.error;
    }
    // @ts-ignore
    const result = (q?.data?.[0]?.id | _ids?.[start]?.[path?.[0]] | 0);
    if (!result && path[path.length - 1] !== true) {
      throw new Error(`Id not found by [${JSON.stringify([start, ...path])}]`);
    }
    return result;
  };

  /**
   * This function fetches the corresponding IDs from the Deep for each specified path.
   *
   * @async
   * @function ids
   * @param {Array<[DeepClientStartItem, ...DeepClientPathItem[]]>} paths - An array of [start, ...path] tuples.
   *     Each tuple specifies a path to a link, where 'start' is the package name or id 
   *     and ...path further specifies the path to the id using Contain link values (names).
   *
   * @returns {Promise<any>} - Returns a Promise that resolves to an object.
   *    The object has keys corresponding to the package name or id of each path.
   *    The value for each package key is an object where keys are the items in the corresponding path,
   *    and the values are the IDs retrieved from the Deep.
   * 
   * @throws Will throw an error if the id retrieval fails in `this.id()` function.
   * 
   * @example
   * ```ts
   *   const ids = await deep.ids([
   *     ['@deep-foundation/core', 'Package'], 
   *     ['@deep-foundation/core', 'PackageVersion']
   *   ]);
   * 
   *   // Outputs
   *   // {
   *   //   "@deep-foundation/core": {
   *   //     "Package": 2,
   *   //     "PackageVersion": 46
   *   //   }
   *   // }
   * ```
   */
  async ids(...paths: Array<[DeepClientStartItem, ...DeepClientPathItem[]]>): Promise<any> {
    // TODO: it can be faster using a combiniation of simple select of packages and contains with specified names and recombination of these links in minilinks
    
    // At the moment it may be slow, but it demonstrates desired API.

    const appendPath = (accumulator, keys, value) => {
      const lastKey = keys.pop();
      const lastObject = keys.reduce((obj, key) => obj[key] = obj[key] || {}, accumulator);
      lastObject[lastKey] = value;
    };
    const result = {};
    await Promise.all(paths.map(async ([start, ...path]) => {
      const id = await this.id(start, ...path);
      appendPath(result, [start, ...path], id);
    }));
    return result;
  }

  /**
   * Find id of a link from minilinks by link name or id and contain values (names) as path items
   * @param start A name or id of a link
   * @param path Contain values (names) as path items
   * @returns A promise that resolves to the id of the link
   * 
   * @example
   * #### Get Core Package Link Id
   * ```
   * const corePackageLinkId = deep.idLocal("@deep-foundation/core")
   * ```
   * 
   * #### Get User Type Link Id From Core Package
   * ```
   * const userTypeLinkId = deep.idLocal("@deep-foundation/core", "User")
   * ```
   * 
   * #### Get the link called "My Nested Link Name" contained in the link called "My Link Name" contained the current user
   * ```
   * const myLinkId = deep.idLocal(deep.linkId, 'My Link Name', 'My Nested Link Name')
   * ```
   * 
   * #### Get Admin Link Id
   * ```
   * const adminLinkId = deep.idLocal("deep", "admin")
   * ```
   */
  idLocal(start: DeepClientStartItem, ...path: DeepClientPathItem[]): Id {
    const paths = [start, ...path] as [DeepClientStartItem, ...Array<Exclude<DeepClientPathItem, boolean>>];
    if (get(_ids, paths.join('.'))) {
      return get(_ids, paths.join('.'));
    }

    // let result: number;
    // if(paths.length === 1) {
      
    // } else {
    //   result = paths[0] as number;
    //   for (let i = 1; i < paths.length; i++) {
    //     result = this.idLocal(result, paths[i] as Exclude<DeepClientPathItem, boolean>);
    // }
    // }
    
    const [link] = this.minilinks.query({
      id: {
        _id: paths
      }
    }) 
    const result = (link as Link<Id>)?.id;
    
    if(!result) {
      throw new Error(`Id not found by ${JSON.stringify([start, ...path])}`);
    } else {
      return result as number
    }
  };

  /**
   * Logs in as a guest
   * @param options An object with options for the guest login operation
   * @returns A promise that resolves to the result of the guest login operation
   * 
   * @example
   * ```
   * const apolloClient = generateApolloClient({
   *   path: NEXT_PUBLIC_GQL_PATH,
   *   ssl: true,
   * });
   * const unloginedDeep = new DeepClient({ apolloClient });
   * const guestLoginResult = await unloginedDeep.guest();
   * const guestDeep = new DeepClient({ deep: unloginedDeep, ...guestLoginResult });
   * ```
   */
  async guest(options: DeepClientGuestOptions = {}): Promise<DeepClientAuthResult> {
    const relogin = typeof(options.relogin) === 'boolean' ? options.relogin : true;
    const result = await this.apolloClient.query({ query: GUEST });
    const { linkId, token, error } = result?.data?.guest || {};
    if (!error && !!token && relogin) {
      if (this?.handleAuth) setTimeout(() => this?.handleAuth(+linkId, token), 0);
    }
    return { linkId, token, error: !error && (!linkId || !token) ? 'unexepted' : error };
  };

  async jwt(options: DeepClientJWTOptions): Promise<DeepClientAuthResult> {
    const relogin = typeof(options.relogin) === 'boolean' ? options.relogin : false;
    if (options?.token) {
      try {
        const token = options?.token;
        const decoded = parseJwt(token);
        const linkId = decoded?.userId;
        if (!!token && relogin) {
          if (this?.handleAuth) setTimeout(() => this?.handleAuth(+linkId, token), 0);
        }
        return { linkId, token, error: (!linkId || !token) ? 'unexepted' : undefined };
      } catch(e) {
        return { error: e };
      }
    } else if (options?.linkId) {
      const result = await this.apolloClient.query({ query: JWT, variables: { linkId: +options.linkId } });
      const { linkId, token, error } = result?.data?.jwt || {};
      if (!error && !!token && relogin) {
        if (this?.handleAuth) setTimeout(() => this?.handleAuth(+linkId, token), 0);
      }
      return { linkId, token, error: error ? error : (!linkId) ? 'unexepted' : undefined };
    } else return { error: `linkId or token must be provided` };
  };

  /**
   * Returns id of the current user
   * 
   * @example
   * ```
   * const myLinkId = await deep.whoami()
   * ```
   */
  async whoami(): Promise<number | undefined> {
    const result = await this.apolloClient.query({ query: WHOISME });
    this.linkId = result?.data?.jwt?.linkId;
    return result?.data?.jwt?.linkId;
  }

  /**
   * Performs a login operation
   * @param options An object with options for the login operation
   * @returns A promsie that resolves to the result of the login operation
   * 
   * @example
   * ```
   * const apolloClient = generateApolloClient({
   *   path: NEXT_PUBLIC_GQL_PATH,
   *   ssl: true,
   * });
   * const unloginedDeep = new DeepClient({ apolloClient });
   * const guestLoginResult = await unloginedDeep.guest();
   * const guestDeep = new DeepClient({ deep: unloginedDeep, ...guestLoginResult });
   * const adminLoginResult = await guestDeep.login({
   *   linkId: await guestDeep.id('deep', 'admin'),
   * });
   * const deep = new DeepClient({ deep: guestDeep, ...adminLoginResult });
   * ```
   */
  async login(options: DeepClientJWTOptions): Promise<DeepClientAuthResult> {
    return await this.jwt({ ...options, relogin: true })
  };

  /**
   * Performs a logout operation
   * @param options An object with options for the logout operation
   * @returns A promsie that resolves to the result of the logout operation
   */
  async logout(): Promise<DeepClientAuthResult> {
    if (this?.handleAuth) setTimeout(() => this?.handleAuth(0, ''), 0);
    return { linkId: 0, token: '' };
  };

  /**
   * Checks whether {@link subjectUds} can perform {@link actionIds} on {@link objectIds}
   * @param objectIds A link id or an array of link ids to check whether the {@link subjectUds} can perform the {@link actionIds} on
   * @param subjectIds A link id or an array of link ids to check whether they can perform the {@link actionIds} on the {@link objectIds}
   * @param actionIds A link id or an array of link ids to check whether the {@link subjectUds} can perform on the {@link objectIds}
   * @param userIds A link id or an array of link ids from which perspective the check is performed
   * @returns A promise that resolves to a boolean value indicating whether the {@link subjectUds} can perform the {@link actionIds} on the {@link objectIds}
   */
  async can(objectIds: null | Id | Id[], subjectIds: null | Id | Id[], actionIds: null | Id | Id[], userIds: Id | Id[] = this.linkId): Promise<boolean> {
    const where: any = {
    };
    if (objectIds) where.object_id = typeof(objectIds) === 'number' ? { _eq: +objectIds } : { _in: objectIds };
    if (subjectIds) where.subject_id = typeof(subjectIds) === 'number' ? { _eq: +subjectIds } : { _in: subjectIds };
    if (actionIds) where.action_id = typeof(actionIds) === 'number' ? { _eq: +actionIds } : { _in: actionIds };
    const result = await this.select(where, { table: 'can', returning: 'rule_id' });
    return !!result?.data?.length;
  }

  /**
   * Returns a name of a link {@link input} that is located in a value of a contain link pointing to the link {@link input}
   * 
   * @example
   * ```
   * const userTypeLinkId = await deep.id("@deep-foundation/core", "User");
   * const userTypeLinkName = await deep.name(userTypeLinkId);
   * ```
   */
  async name(input: Link<Id> | Id): Promise<string | undefined> {
    const id = typeof(input) === 'number' || typeof(input) === 'string' ? input : input.id;

    // if ((this.minilinks.byId[id] as Link<Id>)?.type_id === this.idLocal('@deep-foundation/core', 'Package')) return (this.minilinks.byId[id] as Link<Id>)?.value?.value;
    const {data: [containLink]} = await this.select({
      type_id: { _id: ['@deep-foundation/core', 'Contain'] },
      to_id: id,
    });
    if (!containLink?.value?.value) {
      const {data: [packageLink]} = await this.select(id);
      if (packageLink?.type_id === this.idLocal('@deep-foundation/core', 'Package')) return packageLink?.value?.value;
    }
    // @ts-ignore
    return containLink?.value?.value;
  };

  /**
   * Returns a name of a link {@link input} that is located in a value of a contain link pointing to the link {@link input} according to links stored in minilinks
   * 
   * @example
   * ```
   * const userTypeLinkId = await deep.id("@deep-foundation/core", "User");
   * const userTypeLinkName = deep.nameLocal(userTypeLinkId);
   * ```
   * Note: "@deep-foundation/core" package, "User" link, Contain link pointing from "@deep-foundation/core" to "User" must be in minilinks
   */
  nameLocal(input: Link<Id> | Id): Id | undefined {
    const id = typeof(input) === 'number' || typeof(input) === 'string' ? input : input?.id;
    if (!id) return;
    // @ts-ignore
    if (this.minilinks.byId[id]?.type_id === this.idLocal('@deep-foundation/core', 'Package')) return this.minilinks.byId[id]?.value?.value;
    return (this.minilinks.byType[this.idLocal('@deep-foundation/core', 'Contain')]?.find((c: any) => c?.to_id === id) as any)?.value?.value;
  }

  /**
   * Imports from a library
   * @param path A path to import from
   * @returns A promise that resolves to the imported value
   * 
   * @remarks
   * Is able to import CommoJS and ESModule libraries.
   * This is the recommended way to import from libraries in deep handlers
   * 
   * @example
   * #### Async handler using import
   * ```
   * async ({deep}) => {
   *   const importResult = await deep.import("my-lib-name");
   * }
   * ```
   */
  async import(path: string) : Promise<any> {
    if (typeof DeepClient.resolveDependency !== 'undefined') {
      try {
        return await DeepClient.resolveDependency(path);
      } catch (e) {
        console.log(`IGNORED ERROR (ignore if you don't see other errors): Call to DeepClient.resolveDependency is failed with`, e);
      }
    }
    if (typeof require !== 'undefined') {
      try {
        return await require(path);
      } catch (e) {
        console.log(`IGNORED ERROR (ignore if you don't see other errors): Call to require is failed with`, e);
      }
    }
    return await import(path);
  }

  Traveler(links: Link<Id>[]) {
    return new NativeTraveler(this, links);
  };
}

export const JWT = gql`query JWT($linkId: Int) {
  jwt(input: {linkId: $linkId}) {
    linkId
    token
  }
}`;

export const WHOISME = gql`query WHOISME {
  jwt(input: {}) {
    linkId
  }
}`;

export const GUEST = gql`query GUEST {
  guest {
    linkId
    token
  }
}`;

export function useAuthNode() {
  return useLocalStore<Id>('use_auth_link_id', 0);
}

export type INamespaces = {
  [name: string]: any;
};
export const DeepNamespaceContext = createContext<{
  all: () => INamespaces;
  select: (namespace: string) => any;
  insert: (namespace: string, deep: any) => void;
  delete: (namespace: string) => void;
}>({
  all: () => ({}),
  select: (namespace: string) => {},
  insert: (namespace: string, deep: any) => {},
  delete: (namespace: string) => {},
});
export const DeepNamespacesContext = createContext<INamespaces>({});

export function useDeepNamespaces() {
  return useContext(DeepNamespacesContext);
};

export function useDeepNamespace(namespace, deep) {
  const namespaces = useContext(DeepNamespaceContext);
  const nameRef = useRef();
  useMemo(() => {
    if (
      (!!nameRef.current && nameRef.current != namespace)
    ) {
      namespaces.delete(nameRef.current);
    }
    if (namespace) {
      if (namespaces.select(namespace) !== deep) {
        namespaces.delete(namespace);
      }
      namespaces.insert(namespace, deep);
    }
  }, [namespace, deep]);
  useEffect(() => {
    return () => nameRef.current && namespaces.delete(namespace);
  }, []);
}
export function DeepNamespaceProvider({ children }: { children: any }) {
  const [namespaces, setNamespaces] = useState<INamespaces>({});
  const ref = useRef(namespaces);
  ref.current = namespaces;
  const api = useMemo(() => {
    return {
      all: () => ref.current,
      select: (namespace: string) => ref.current[namespace],
      insert: (namespace: string, deep: any) => {
        console.log('DeepNamespaceProvider', 'insert', namespace, deep);
        setNamespaces(namespaces => ({ ...namespaces, [namespace]: deep }));
      },
      delete: (namespace: string) => {
        console.log('DeepNamespaceProvider', 'delete', namespace);
        setNamespaces(namespaces => ({ ...namespaces, [namespace]: undefined }));
      },
    };
  }, []);
  useEffect(() => {
    console.log('DeepNamespaceProvider', 'mounted', api);
    // @ts-ignore
    if (typeof(window) == 'object') window.dn = api;
  }, []);
  return <DeepNamespaceContext.Provider value={api}>
    <DeepNamespacesContext.Provider value={namespaces}>
      {children}
    </DeepNamespacesContext.Provider>
  </DeepNamespaceContext.Provider>
}

export const DeepContext = createContext<DeepClient<Link<Id>>>(undefined);

export function useDeepGenerator(generatorOptions?: DeepClientOptions<Link<Id>>) {
  const { apolloClient: apolloClientProps, minilinks, ...otherGeneratorOptions } = generatorOptions;
  const log = debug.extend(useDeepGenerator.name)
  const apolloClientHook = useApolloClient();
  log({apolloClientHook})
  const apolloClient: IApolloClient<any> = apolloClientProps || apolloClientHook;
  log({apolloClient})

  const [linkId, setLinkId] = useAuthNode();
  log({linkId, setLinkId})
  const [token, setToken] = useTokenController();
  log({token, setToken})

  const deep = useMemo(() => {
    if (!apolloClient?.jwt_token) {
      log({ token, apolloClient });
    }
    return new DeepClient({
      ...otherGeneratorOptions,
      apolloClient, linkId, token,
      minilinks,
      handleAuth: (linkId, token) => {
        setToken(token);
        setLinkId(linkId);
      },
    });
  }, [apolloClient]);
  log({deep})
  return deep;
}

export function DeepProvider({
  apolloClient: apolloClientProps,
  minilinks: inputMinilinks,
  namespace,
  children,
}: {
  apolloClient?: IApolloClient<any>,
  minilinks?: MinilinkCollection,
  namespace?: string;
  children: any;
}) {
  const providedMinilinks = useMinilinks();
  const deep = useDeepGenerator({
    apolloClient: apolloClientProps,
    minilinks: inputMinilinks || providedMinilinks,
    namespace,
  });
  useDeepNamespace(namespace, deep);
  return <DeepContext.Provider value={deep}>
    {children}
  </DeepContext.Provider>;
}

export function useDeep() {
  return useContext(DeepContext);
}

export const randomName = () => Math.random().toString(36).slice(2, 7);

export function useDeepQuery<Table extends 'links'|'numbers'|'strings'|'objects'|'can'|'selectors'|'tree'|'handlers', LL = Link<Id>>(
  query: Exp<Table>,
  options?: Options<Table>,
): {
  data?: LL[];
  error?: any;
  loading: boolean;
} {
  const [miniName] = useState(options?.mini || randomName());
  debug('useDeepQuery', miniName, query, options);
  const _deep = useDeep();
  const deep = options?.deep || _deep;
  const wq = useMemo(() => {
    return deep._generateQuery<Table>(query, { ...options });
  }, [query, options]);
  const result = useQuery(wq?.query?.query, { variables: wq?.query?.variables, client: deep.apolloClient });
  const [generatedResult, setGeneratedResult] = useState([]);
  useEffect(() => {
    if (options?.aggregate) setGeneratedResult((result)?.data?.q0?.aggregate?.[options.aggregate]);
    else {
      (async () => {
        setGeneratedResult(await deep._generateResult(query, options, result?.data?.q0));
      })();
    }
  }, [result]);
  const toReturn = {
    ...result,
    data: generatedResult,
    deep,
    // @ts-ignore
    return: query?.return,
  };
  useMinilinksApply(deep.minilinks, miniName, toReturn);
  toReturn.data = deep.useMinilinksSubscription({ id: { _in: toReturn?.data?.map(l => l.id) } });
  return toReturn;
}

export function useDeepSubscription<Table extends 'links'|'numbers'|'strings'|'objects'|'can'|'selectors'|'tree'|'handlers', LL = Link<Id>>(
  query: Exp<Table>,
  options?: Options<Table>,
): UseDeepSubscriptionResult<LL> {
  const [miniName] = useState(options?.mini || Math.random().toString(36).slice(2, 7));
  debug('useDeepSubscription', miniName, query, options);
  const _deep = useDeep();
  const deep = options?.deep || _deep;
  useState({query, options, deep});
  const wq = useMemo(() => {
    return deep._generateQuery(query, { ...options, subscription: true });
  }, [query, options]);
  const result = useSubscription(wq?.query?.query, { variables: wq?.query?.variables, client: deep.apolloClient });
  const [generatedResult, setGeneratedResult] = useState([]);
  useEffect(() => {
    if (options?.aggregate) setGeneratedResult((result)?.data?.q0?.aggregate?.[options.aggregate]);
    else {
      if (!result.loading) {
        (async () => {
          setGeneratedResult(await deep._generateResult(query, options, result?.data?.q0));
        })();
      }
    }
  }, [result]);
  const toReturn = {
    ...result,
    data: generatedResult,
    deep,
    // @ts-ignore
    return: query?.return,
  };
  useMinilinksApply(deep.minilinks, miniName, toReturn);
  toReturn.data = useMinilinksSubscription(deep.minilinks,{ id: { _in: toReturn?.data?.map(l => l.id) } });
  return toReturn;
}

export interface UseDeepSubscriptionResult<LL = Link<Id>> {
  data?: LL[];
  error?: any;
  loading: boolean;
}

export function useDeepId(start: DeepClientStartItem | QueryLink, ...path: DeepClientPathItem[]): { data: Id; loading: boolean; error?: any } {
  return useDeep().useDeepId(start, ...path);
}

export function _useDeepId(deep: DeepClient<Link<Id>>, start: DeepClientStartItem | QueryLink, ...path: DeepClientPathItem[]): { data: Id; loading: boolean; error?: any } {
  const result = deep.useDeepQuery({ id: { _id: [start, ...path] } });
  return { data: result?.data?.[0]?.id, loading: result?.loading, error: result?.error };
}

export type Exp<TTable extends Table = 'links'> = (
  TTable extends 'numbers' ? BoolExpValue<number> :
  TTable extends 'strings' ? BoolExpValue<string> :
  TTable extends 'objects' ? BoolExpValue<object> :
  TTable extends 'can' ? BoolExpCan :
  TTable extends 'selectors' ? BoolExpSelector :
  TTable extends 'tree' ? BoolExpTree :
  TTable extends 'handlers' ? BoolExpHandler :
  QueryLink
) | Id | Id[];

export type UpdateValue<TTable extends Table = 'links'> = (
  TTable extends 'numbers' ? MutationInputValue<number> :
  TTable extends 'strings' ? MutationInputValue<string> :
  TTable extends 'objects' ? MutationInputValue<any> :
  MutationInputLinkPlain
);

export type InsertObjects<TTable extends Table = 'links'> = (
  TTable extends 'numbers' ? MutationInputValue<number> :
  TTable extends 'strings' ? MutationInputValue<string> :
  TTable extends 'objects' ? MutationInputValue<any> :
  MutationInputLink
) | (
  TTable extends 'numbers' ? MutationInputValue<number> :
  TTable extends 'strings' ? MutationInputValue<string> :
  TTable extends 'objects' ? MutationInputValue<any> :
  MutationInputLink
)[]

export type Options<TTable extends Table = 'links'> = {
  table?: TTable;
  tableNamePostfix?: string;
  returning?: string;
  variables?: any;
  name?: string;
  aggregate?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  mini?: string;
  deep?: DeepClient<Link<Id>>;
  subscription?: boolean;
};

export type ReadOptions<TTable extends Table = 'links'> = Options<TTable>;

export type WriteOptions<TTable extends Table = 'links'>  = Options<TTable> & {
  silent?: boolean;
  remote?: boolean;
  local?: boolean;
}

