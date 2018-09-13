import setup, { pouchSetup, server, teardown, model } from './utils/db';
import { PouchDB } from 'rxdb';
import { autorun } from 'mobx';

jest.setTimeout(20000);

describe(`- Basic setup`, () => {
  test(`throws when model doesn't have a name property`, async () => {
    expect.assertions(1);

    const db = await setup();
    const data = model('items');
    delete data.name;

    await expect(db.collection(data)).rejects.toThrow();
    await teardown(db);
  });
  test(`throws when there is no schema or no schema.properties`, async () => {
    expect.assertions(2);

    const db = await setup();
    const data1 = model('items');
    const data2 = model('items');
    delete data1.schema;
    delete data2.schema.properties;

    await expect(db.collection(data1)).rejects.toThrow();
    await expect(db.collection(data2)).rejects.toThrow();
    await teardown(db);
  });
  test(`throws when a property is called rx_model`, async () => {
    expect.assertions(1);

    const db = await setup();
    const data = model('items');
    data.schema.properties.rx_model = {
      type: 'string',
      enum: ['items'],
      default: 'some'
    };

    await expect(db.collection(data)).rejects.toThrow();
    await teardown(db);
  });
  test(`doesn't throw when a property called rx_model has the same definition`, async () => {
    expect.assertions(1);

    const db = await setup();
    const data = model('items');
    data.schema.properties.rx_model = {
      type: 'string',
      enum: ['items'],
      default: 'items'
    };

    await expect(db.collection(data)).resolves.toBeTruthy();
    await teardown(db);
  });
  test(`adds rx_model`, async () => {
    expect.assertions(1);

    const db = await setup();
    await db.collection(model('items'));
    await db.collections.items.insert({});
    const item = await db.collections.items.findOne().exec();

    expect(item.rx_model).toBe('items');
    await teardown(db);
  });

  test(`db.replicate() exists`, async () => {
    expect.assertions(1);

    const db = await setup();

    expect(typeof db.replicate).toBe('function');
    await teardown(db);
  });

  test(`db.replications exists`, async () => {
    expect.assertions(1);

    const db = await setup();

    expect(Array.isArray(db.replications)).toBe(true);
    await teardown(db);
  });

  test(`replication methods and properties`, async () => {
    expect.assertions(7);

    const db = await setup();
    const dbPouch = pouchSetup();
    const replication = db.replicate(dbPouch);

    expect(typeof replication.connect).toBe('function');
    expect(typeof replication.close).toBe('function');
    expect(typeof replication.destroy).toBe('function');
    expect(Array.isArray(replication.replicationStates)).toBe(true);
    expect(typeof replication.alive).toBe('boolean');
    expect(replication.alive$).toHaveProperty('subscribe');
    expect(typeof replication.alive$.subscribe).toBe('function');

    await teardown(replication, dbPouch, db);
  });
});

describe(`- Sync`, () => {
  test(`Sync works`, async () => {
    expect.assertions(3);

    const db = await setup();
    await db.collection(model('items'));

    const dbPouch = pouchSetup();
    const replication = db.replicate(dbPouch);
    await replication.connect();

    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(db.replications.length).toBe(1);
    expect(replication.replicationStates.length).toBe(1);
    await expect(dbPouch.get(item._id)).resolves.toHaveProperty('name', 'some');

    await teardown(replication, dbPouch, db);
  });
  test(`Sync w/ keyCompression works`, async () => {
    expect.assertions(3);

    const db = await setup();
    await db.collection({
      ...model('items'),
      disableKeyCompression: false
    });

    const dbPouch = pouchSetup();
    const replication = db.replicate(dbPouch);
    await replication.connect();

    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(db.replications.length).toBe(1);
    expect(replication.replicationStates.length).toBe(1);
    await expect(dbPouch.get(item._id)).resolves.toHaveProperty('name', 'some');

    await teardown(replication, dbPouch, db);
  });
  test(`Double sync works`, async () => {
    expect.assertions(3);

    const db = await setup();
    await db.collection(model('items'));

    const dbPouch1 = pouchSetup();
    const dbPouch2 = pouchSetup();
    const replication1 = db.replicate(dbPouch1);
    const replication2 = db.replicate(dbPouch2);
    await replication1.connect();
    await replication2.connect();

    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(db.replications.length).toBe(2);
    await expect(dbPouch1.get(item._id)).resolves.toHaveProperty(
      'name',
      'some'
    );
    await expect(dbPouch2.get(item._id)).resolves.toHaveProperty(
      'name',
      'some'
    );

    await teardown(replication1, replication2, dbPouch1, dbPouch2, db);
  });
  test(`Selective sync works`, async () => {
    expect.assertions(3);

    const db = await setup();
    await db.collection(model('items'));
    await db.collection(model('elements'));

    const dbPouch = pouchSetup();
    const replication = db.replicate(dbPouch);
    await replication.connect();

    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(replication.replicationStates.length).toBe(2);
    await expect(dbPouch.get(item._id)).resolves.toHaveProperty('name', 'some');
    await expect(db.collections.elements.find().exec()).resolves.toHaveLength(
      0
    );

    await teardown(replication, dbPouch, db);
  });
  test(`Collections selection works`, async () => {
    expect.assertions(2);

    const db = await setup();
    await db.collection(model('items'));
    await db.collection(model('elements'));

    const dbPouch = pouchSetup();
    const replication = db.replicate(dbPouch, [
      'items',
      'nonexistentcollection'
    ]);
    await replication.connect();

    await db.collections.elements.insert({ name: 'some' });
    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();
    const element = await db.collections.elements.findOne().exec();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await expect(dbPouch.get(item._id)).resolves.toHaveProperty('name', 'some');
    await expect(dbPouch.get(element._id)).rejects.toThrow();

    await teardown(replication, dbPouch, db);
  });
});

describe(`- Functionality`, () => {
  test(`replication.close() closes the connection`, async () => {
    expect.assertions(2);

    const db = await setup();
    await db.collection(model('items'));

    const dbPouch = pouchSetup();
    const replication = db.replicate(dbPouch);
    await replication.connect();
    await replication.close();

    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(db.replications.length).toBe(1);
    await expect(dbPouch.get(item._id)).rejects.toThrow();

    await teardown(replication, dbPouch, db);
  });
  test(`replication.destroy() destroys replication`, async () => {
    expect.assertions(2);

    const db = await setup();
    await db.collection(model('items'));

    const dbPouch = pouchSetup();
    const replication = db.replicate(dbPouch);
    await replication.connect();
    await replication.destroy();

    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(db.replications.length).toBe(0);
    await expect(dbPouch.get(item._id)).rejects.toThrow();

    await teardown(dbPouch, db);
  });
});

describe(`- Remote sync`, () => {
  test(`Basic remote sync works`, async () => {
    expect.assertions(3);

    const { run, url } = server();
    const proc = run();

    // First run might take longer
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const db = await setup();
    await db.collection(model('items'));

    const dbPouch = new PouchDB(url);
    const replication = db.replicate(url);
    await replication.connect();

    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(db.replications.length).toBe(1);
    expect(replication.replicationStates.length).toBe(1);
    await expect(dbPouch.get(item._id)).resolves.toHaveProperty('name', 'some');

    await teardown(replication, dbPouch, db);
    proc.kill('SIGINT');
  });
  test(`Recovers connection midway`, async () => {
    expect.assertions(3);

    const { run, url } = server();

    const db = await setup();
    await db.collection(model('items'));

    /* eslint-disable no-console */
    const ce = console.error;
    console.error = () => {};
    const dbPouch = new PouchDB(url);
    const replication = db.replicate(url);
    await replication.connect();
    console.error = ce;
    /* eslint-enable no-console */

    await db.collections.items.insert({ name: 'some' });
    const item = await db.collections.items.findOne().exec();

    const proc = run();
    // Connection recovery interval is 5s
    await new Promise((resolve) => setTimeout(resolve, 8000));

    expect(db.replications.length).toBe(1);
    expect(replication.replicationStates.length).toBe(1);
    await expect(dbPouch.get(item._id)).resolves.toHaveProperty('name', 'some');

    await teardown(replication, dbPouch, db);
    proc.kill('SIGINT');
  });
  test(`Alive subscriptions work`, async () => {
    expect.assertions(7);

    const { run, url } = server();

    const db = await setup();
    await db.collection(model('items'));

    /* eslint-disable no-console */
    const ce = console.error;
    console.error = () => {};
    const replication = db.replicate(url);
    await replication.connect();
    console.error = ce;
    /* eslint-enable no-console */

    let aliveS = false;
    let aliveM = false;
    const subscription = replication.alive$.subscribe(
      (state) => (aliveS = state)
    );
    const disposer = autorun(() => (aliveM = replication.alive));
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(subscription).toHaveProperty('unsubscribe');
    expect(typeof subscription.unsubscribe).toBe('function');
    expect(typeof disposer).toBe('function');
    expect(aliveS).toBe(false);
    expect(aliveM).toBe(false);

    const proc = run();
    // Connection recovery interval is 5s
    await new Promise((resolve) => setTimeout(resolve, 8000));

    expect(aliveS).toBe(true);
    expect(aliveM).toBe(true);

    subscription.unsubscribe();
    disposer();
    await teardown(replication, db);
    proc.kill('SIGINT');
  });
});
