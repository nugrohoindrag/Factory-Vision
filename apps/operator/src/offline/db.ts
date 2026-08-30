import { openDB, DBSchema } from 'idb';
import { OfflineCommand } from '@factory-vision/domain-types';

interface OperatorDB extends DBSchema {
  commands: {
    key: number;
    value: OfflineCommand;
    indexes: {
      'by-clientEventId': string;
      'by-status': string;
      'by-workOrder': string;
    };
  };
}

const DB_NAME = 'factory-vision-operator-db';
const DB_VERSION = 1;

export async function getOperatorDb() {
  return openDB<OperatorDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('commands')) {
        const store = db.createObjectStore('commands', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('by-clientEventId', 'clientEventId', { unique: true });
        store.createIndex('by-status', 'status');
        store.createIndex('by-workOrder', 'workOrderId');
      }
    },
  });
}
