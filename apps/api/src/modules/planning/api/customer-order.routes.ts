import { Router } from 'express';
import { CustomerOrderStatus, OrderChannel } from '@factory-vision/domain-types';
import { route } from '../../../platform/http/envelope.js';
import { validate } from '../../../platform/http/validate.js';
import { ApiError } from '../../../platform/http/api-error.js';
import type { CustomerOrderService, CustomerOrderLineInput } from '../application/customer-order.service.js';
import { actorOf } from './customer.routes.js';

const ORDER_CHANNELS = Object.values(OrderChannel) as [OrderChannel, ...OrderChannel[]];
const ORDER_STATUSES = Object.values(CustomerOrderStatus) as [
  CustomerOrderStatus,
  ...CustomerOrderStatus[],
];

/**
 * Parses one order line from a request body.
 *
 * Validation is per field and collected, not first-failure: MES-023 requires
 * the form to show a message beside each bad input, which is only possible if
 * the API reports all of them at once.
 */
function parseLine(raw: unknown, index: number): CustomerOrderLineInput {
  if (typeof raw !== 'object' || raw === null) {
    throw ApiError.validation('Order line tidak valid.', [
      { field: `lines[${index}]`, code: 'INVALID_TYPE', message: 'Order line harus berupa objek.' },
    ]);
  }
  const v = validate(raw as Record<string, unknown>);
  const productId = v.string('productId');
  const orderedQuantity = v.number('orderedQuantity', { min: 1, integer: true });
  const unit = v.string('unit', { optional: true, max: 32 });
  const modelType = v.string('modelType', { optional: true, max: 64 });
  const requestedDeliveryDate = v.isoDate('requestedDeliveryDate', { optional: true });
  v.done(`Order line ${index + 1} tidak valid.`);

  return {
    productId: productId!,
    orderedQuantity: orderedQuantity!,
    unit,
    modelType,
    requestedDeliveryDate,
  };
}

/** `/v1/customer-orders` (MES-021, MES-022, MES-025, MES-026). */
export function customerOrderRoutes(orders: CustomerOrderService): Router {
  const router = Router();

  router.get(
    '/customer-orders',
    route(async (req, res) => {
      const statusParam = req.query.status;
      const statuses =
        typeof statusParam === 'string' && statusParam
          ? (statusParam.split(',').filter((s) => ORDER_STATUSES.includes(s as CustomerOrderStatus)) as CustomerOrderStatus[])
          : undefined;

      res.json(
        await orders.list(req.context!.tenantId, {
          status: statuses,
          customerId: typeof req.query.customerId === 'string' ? req.query.customerId : undefined,
          productId: typeof req.query.productId === 'string' ? req.query.productId : undefined,
          deliveryFrom: typeof req.query.deliveryFrom === 'string' ? req.query.deliveryFrom : undefined,
          deliveryTo: typeof req.query.deliveryTo === 'string' ? req.query.deliveryTo : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
        })
      );
    })
  );

  router.get(
    '/customer-orders/:id',
    route(async (req, res) => {
      res.json(await orders.get(req.context!.tenantId, req.params.id));
    })
  );

  router.post(
    '/customer-orders',
    route(async (req, res) => {
      const v = validate(req.body);
      const customerId = v.string('customerId');
      // Order Channel is mandatory: §45 makes it the record of where the demand
      // came from, which is the only way a disputed order can be traced back.
      const orderChannel = v.oneOf('orderChannel', ORDER_CHANNELS);
      const requestedDeliveryDate = v.isoDate('requestedDeliveryDate');
      const orderDate = v.isoDate('orderDate', { optional: true });
      const poNumber = v.string('poNumber', { optional: true, max: 64 });
      const customerPic = v.string('customerPic', { optional: true, max: 255 });
      const deliveryAddress = v.string('deliveryAddress', { optional: true });
      const dockNumber = v.string('dockNumber', { optional: true, max: 64 });
      const documentUrl = v.string('documentUrl', { optional: true });

      const rawLines = (req.body as { lines?: unknown }).lines;
      if (rawLines !== undefined && !Array.isArray(rawLines)) {
        v.reject('lines', 'INVALID_TYPE', 'lines harus berupa daftar order line.');
      }
      v.done();

      const lines = Array.isArray(rawLines) ? rawLines.map(parseLine) : [];

      const created = await orders.create(
        req.context!.tenantId,
        {
          customerId: customerId!,
          orderChannel: orderChannel!,
          requestedDeliveryDate: requestedDeliveryDate!.slice(0, 10),
          orderDate: orderDate?.slice(0, 10),
          poNumber,
          customerPic,
          deliveryAddress,
          dockNumber,
          documentUrl,
          lines,
        },
        actorOf(req)
      );
      res.status(201).json(created);
    })
  );

  router.patch(
    '/customer-orders/:id',
    route(async (req, res) => {
      const v = validate(req.body);
      const customerId = v.string('customerId', { optional: true });
      const orderChannel = v.oneOf('orderChannel', ORDER_CHANNELS, { optional: true });
      const requestedDeliveryDate = v.isoDate('requestedDeliveryDate', { optional: true });
      const poNumber = v.string('poNumber', { optional: true, max: 64 });
      const customerPic = v.string('customerPic', { optional: true, max: 255 });
      const deliveryAddress = v.string('deliveryAddress', { optional: true });
      const dockNumber = v.string('dockNumber', { optional: true, max: 64 });
      const documentUrl = v.string('documentUrl', { optional: true });
      v.done();

      res.json(
        await orders.update(
          req.context!.tenantId,
          req.params.id,
          {
            customerId,
            orderChannel,
            requestedDeliveryDate: requestedDeliveryDate?.slice(0, 10),
            poNumber,
            customerPic,
            deliveryAddress,
            dockNumber,
            documentUrl,
          },
          actorOf(req)
        )
      );
    })
  );

  // --- Lines (MES-022) ------------------------------------------------

  router.get(
    '/customer-orders/:id/lines',
    route(async (req, res) => {
      res.json(await orders.listLines(req.context!.tenantId, req.params.id));
    })
  );

  router.post(
    '/customer-orders/:id/lines',
    route(async (req, res) => {
      const line = parseLine(req.body, 0);
      res
        .status(201)
        .json(await orders.addLine(req.context!.tenantId, req.params.id, line, actorOf(req)));
    })
  );

  router.patch(
    '/customer-orders/:id/lines/:lineId',
    route(async (req, res) => {
      const v = validate(req.body);
      const orderedQuantity = v.number('orderedQuantity', { optional: true, min: 1, integer: true });
      const unit = v.string('unit', { optional: true, max: 32 });
      const modelType = v.string('modelType', { optional: true, max: 64 });
      const requestedDeliveryDate = v.isoDate('requestedDeliveryDate', { optional: true });
      v.done();

      res.json(
        await orders.updateLine(
          req.context!.tenantId,
          req.params.id,
          req.params.lineId,
          {
            orderedQuantity,
            unit,
            modelType,
            requestedDeliveryDate: requestedDeliveryDate?.slice(0, 10),
          },
          actorOf(req)
        )
      );
    })
  );

  router.delete(
    '/customer-orders/:id/lines/:lineId',
    route(async (req, res) => {
      await orders.removeLine(req.context!.tenantId, req.params.id, req.params.lineId, actorOf(req));
      res.json({ success: true, message: 'Order line dihapus.' });
    })
  );

  // --- Documents (MES-025) --------------------------------------------

  router.get(
    '/customer-orders/:id/documents',
    route(async (req, res) => {
      res.json(await orders.listDocuments(req.context!.tenantId, req.params.id));
    })
  );

  router.post(
    '/customer-orders/:id/documents',
    route(async (req, res) => {
      const v = validate(req.body);
      const fileName = v.string('fileName', { min: 1, max: 255 });
      const contentType = v.string('contentType', { min: 1, max: 128 });
      const sizeBytes = v.number('sizeBytes', { min: 1, integer: true });
      // Base64 in the JSON body: the console reads the file with FileReader and
      // there is no multipart parser in this stack. `express.json` is capped at
      // 8 MB, below the 10 MB the service enforces, so an oversized file is
      // refused before it is buffered.
      const content = v.string('content', { optional: true, min: 1 });
      const storageUrl = v.string('storageUrl', { optional: true, min: 1 });
      v.done();

      res.status(201).json(
        await orders.attachDocument(
          req.context!.tenantId,
          req.params.id,
          { fileName: fileName!, contentType: contentType!, sizeBytes: sizeBytes!, content, storageUrl },
          actorOf(req)
        )
      );
    })
  );

  /**
   * Serves a stored document (MES-025: "dokumen dapat dilihat role yang
   * berwenang").
   *
   * Registered before `/customer-orders/:id` would match it, and scoped to the
   * caller's tenant — the object id alone is not authorisation.
   */
  router.get(
    '/customer-orders/documents/:objectId/content',
    route(async (req, res) => {
      const { buffer, contentType } = await orders.readDocumentContent(
        req.context!.tenantId,
        req.params.objectId
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buffer);
    })
  );

  router.delete(
    '/customer-orders/:id/documents/:documentId',
    route(async (req, res) => {
      await orders.removeDocument(req.context!.tenantId, req.params.documentId, actorOf(req));
      res.json({ success: true, message: 'Dokumen dihapus.' });
    })
  );

  // --- Status (MES-026) -----------------------------------------------

  router.post(
    '/customer-orders/:id/cancel',
    route(async (req, res) => {
      const v = validate(req.body);
      const reason = v.string('reason', { min: 3 });
      v.done();
      res.json(await orders.cancel(req.context!.tenantId, req.params.id, reason!, actorOf(req)));
    })
  );

  router.post(
    '/customer-orders/:id/logistics-status',
    route(async (req, res) => {
      const v = validate(req.body);
      const status = v.oneOf('status', [
        CustomerOrderStatus.READY_TO_SHIP,
        CustomerOrderStatus.SHIPPED,
        CustomerOrderStatus.COMPLETED,
      ] as const);
      v.done();
      res.json(
        await orders.setLogisticsStatus(req.context!.tenantId, req.params.id, status!, actorOf(req))
      );
    })
  );

  /** Recomputes derived status on demand; the derivation itself is automatic. */
  router.post(
    '/customer-orders/:id/refresh-status',
    route(async (req, res) => {
      const updated = await orders.recomputeStatus(req.context!.tenantId, req.params.id);
      if (!updated) throw ApiError.notFound('Customer Order tidak ditemukan.');
      res.json(updated);
    })
  );

  return router;
}
