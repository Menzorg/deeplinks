var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { generateApolloClient } from '@deep-foundation/hasura/client.js';
import { DeepClient } from "../imports/client";
import { assert } from 'chai';
const apolloClient = generateApolloClient({
    path: `${process.env.DEEPLINKS_HASURA_PATH}/v1/graphql`,
    ssl: !!+process.env.DEEPLINKS_HASURA_SSL,
    secret: process.env.DEEPLINKS_HASURA_SECRET,
});
const root = new DeepClient({ apolloClient });
let adminToken;
let deep;
describe('typing', () => {
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        const { linkId, token } = yield root.jwt({ linkId: yield root.id('deep', 'admin') });
        adminToken = token;
        deep = new DeepClient({ deep: root, token: adminToken, linkId });
    }));
    it(`type required`, () => __awaiter(void 0, void 0, void 0, function* () {
        let throwed = false;
        try {
            yield deep.insert({ type_id: 999999 });
        }
        catch (error) {
            throwed = true;
        }
        assert.equal(throwed, true);
    }));
    it(`particular links`, () => __awaiter(void 0, void 0, void 0, function* () {
        let throwed = false;
        try {
            yield deep.insert({ type_id: 1, from_id: 1 });
        }
        catch (error) {
            throwed = true;
        }
        assert.equal(throwed, true);
    }));
    it(`type 1`, () => __awaiter(void 0, void 0, void 0, function* () {
        const { data: [{ id }] } = yield deep.insert({ type_id: 1 });
        assert.equal(typeof (id), 'number');
    }));
    it(`custom id restricted`, () => __awaiter(void 0, void 0, void 0, function* () {
        let throwed = false;
        try {
            yield deep.insert({ id: 8888888, type_id: 1 });
        }
        catch (error) {
            throwed = true;
        }
        assert.equal(throwed, true);
    }));
    it(`link equal from/to type`, () => __awaiter(void 0, void 0, void 0, function* () {
        const { data: [{ id: typeFromId }] } = yield deep.insert({ type_id: 1 });
        const { data: [{ id: typeToId }] } = yield deep.insert({ type_id: 1 });
        const { data: [{ id: typeId }] } = yield deep.insert({ type_id: 1, from_id: typeFromId, to_id: typeToId });
        const { data: [{ id: fromId }] } = yield deep.insert({ type_id: typeFromId });
        const { data: [{ id: toId }] } = yield deep.insert({ type_id: typeToId });
        yield deep.insert({ type_id: typeId, from_id: fromId, to_id: toId });
    }));
    it(`link invalid from type`, () => __awaiter(void 0, void 0, void 0, function* () {
        const { data: [{ id: typeFromToId }] } = yield deep.insert({ type_id: 1 });
        const { data: [{ id: invalidTypeId }] } = yield deep.insert({ type_id: 1 });
        const { data: [{ id: typeId }] } = yield deep.insert({ type_id: 1, from_id: typeFromToId, to_id: typeFromToId });
        const { data: [{ id: fromId }] } = yield deep.insert({ type_id: typeFromToId });
        const { data: [{ id: toId }] } = yield deep.insert({ type_id: invalidTypeId });
        let throwed = false;
        try {
            yield deep.insert({ type_id: typeId, from_id: fromId, to_id: toId });
        }
        catch (error) {
            assert.isTrue(error.message.startsWith('Type conflict link: { id: '));
            assert.isTrue(error.message.endsWith(`type: ${typeId}, from: ${fromId}, to: ${toId} } expected type: { type: ${typeId}, from: ${typeFromToId}, to: ${typeFromToId} } received type: { type: ${typeId}, from: ${typeFromToId}, to: ${invalidTypeId} }`));
            throwed = true;
        }
        assert.equal(throwed, true);
    }));
});
//# sourceMappingURL=typing.js.map