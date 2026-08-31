import { Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseFilters, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Request } from "express";
import { CustomersService } from "./customers.service";
import { ContactsService } from "./contacts.service";
import { SitesService } from "./sites.service";
import { InquiriesService } from "./inquiries.service";
import { QuotationsService } from "../quotations/quotations.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { ServiceReportsService, MAX_UPLOAD_BYTES } from "../service-reports/service-reports.service";
import { CreateCustomerDto } from "./dto/create-customer.dto";
import { UpdateCustomerDto } from "./dto/update-customer.dto";
import { UpdateCustomerStatusDto } from "./dto/update-customer-status.dto";
import { CreateContactDto } from "./dto/create-contact.dto";
import { CreateSiteDto } from "./dto/create-site.dto";
import { CreateInquiryDto } from "./dto/create-inquiry.dto";
import { CreateQuotationDto } from "../quotations/dto/create-quotation.dto";
import { CreateStandaloneWorkOrderDto } from "../work-orders/dto/create-standalone-work-order.dto";
import { UploadServiceReportDto } from "../service-reports/dto/upload-service-report.dto";
import { ServiceReportMulterExceptionFilter } from "../service-reports/service-report-multer-exception.filter";
import { Permissions } from "../../common/guards/permissions.decorator";
// No @UseGuards(PermissionsGuard) anywhere below — it's already global
// (AppModule's APP_GUARD); see users.controller.ts / audit.controller.ts.

interface AuthedRequest extends Request {
  user: { userId: string };
}

function actorFrom(req: AuthedRequest) {
  return { userId: req.user.userId, ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined };
}

@Controller("customers")
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly contactsService: ContactsService,
    private readonly sitesService: SitesService,
    private readonly inquiriesService: InquiriesService,
    private readonly quotationsService: QuotationsService,
    private readonly workOrdersService: WorkOrdersService,
    private readonly serviceReportsService: ServiceReportsService,
  ) {}

  @Permissions({ module: "customers", action: "read" })
  @Get()
  async list() {
    return this.customersService.list();
  }

  @Permissions({ module: "customers", action: "read" })
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.customersService.findByIdOrThrow(id);
  }

  @Permissions({ module: "customers", action: "create" })
  @Post()
  async create(@Body() dto: CreateCustomerDto, @Req() req: AuthedRequest) {
    return this.customersService.create(dto, actorFrom(req));
  }

  @Permissions({ module: "customers", action: "update" })
  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateCustomerDto, @Req() req: AuthedRequest) {
    return this.customersService.update(id, dto, actorFrom(req));
  }

  @Permissions({ module: "customers", action: "deactivate" })
  @Patch(":id/status")
  async updateStatus(@Param("id") id: string, @Body() dto: UpdateCustomerStatusDto, @Req() req: AuthedRequest) {
    return this.customersService.updateStatus(id, dto.status, actorFrom(req));
  }

  @Permissions({ module: "contacts", action: "read" })
  @Get(":id/contacts")
  async listContacts(@Param("id") id: string) {
    return this.contactsService.listForCustomer(id);
  }

  @Permissions({ module: "contacts", action: "create" })
  @Post(":id/contacts")
  async createContact(@Param("id") id: string, @Body() dto: CreateContactDto, @Req() req: AuthedRequest) {
    return this.contactsService.create(id, dto, actorFrom(req));
  }

  @Permissions({ module: "sites", action: "read" })
  @Get(":id/sites")
  async listSites(@Param("id") id: string) {
    return this.sitesService.listForCustomer(id);
  }

  @Permissions({ module: "sites", action: "create" })
  @Post(":id/sites")
  async createSite(@Param("id") id: string, @Body() dto: CreateSiteDto, @Req() req: AuthedRequest) {
    return this.sitesService.create(id, dto, actorFrom(req));
  }

  @Permissions({ module: "inquiries", action: "read" })
  @Get(":id/inquiries")
  async listInquiries(@Param("id") id: string) {
    return this.inquiriesService.listForCustomer(id);
  }

  @Permissions({ module: "inquiries", action: "create" })
  @Post(":id/inquiries")
  async createInquiry(@Param("id") id: string, @Body() dto: CreateInquiryDto, @Req() req: AuthedRequest) {
    return this.inquiriesService.create(id, dto, actorFrom(req));
  }

  @Permissions({ module: "quotations", action: "read" })
  @Get(":id/quotations")
  async listQuotations(@Param("id") id: string) {
    return this.quotationsService.listForCustomer(id);
  }

  @Permissions({ module: "quotations", action: "create" })
  @Post(":id/quotations")
  async createQuotation(@Param("id") id: string, @Body() dto: CreateQuotationDto, @Req() req: AuthedRequest) {
    return this.quotationsService.create(id, dto, actorFrom(req));
  }

  // Phase 4 Step 3 — Path B (standalone, non-quotation Work Orders).
  @Permissions({ module: "work_orders", action: "read" })
  @Get(":id/work-orders")
  async listWorkOrders(@Param("id") id: string) {
    return this.workOrdersService.listForCustomer(id);
  }

  @Permissions({ module: "work_orders", action: "create" })
  @Post(":id/work-orders")
  async createWorkOrder(@Param("id") id: string, @Body() dto: CreateStandaloneWorkOrderDto, @Req() req: AuthedRequest) {
    return this.workOrdersService.createStandalone(id, dto, actorFrom(req));
  }

  // Phase 5 Step 4 — Service Report upload. Every role holding
  // service_reports.upload (Technician included, per §07) may upload here;
  // Technician "own scope" is enforced not by restricting who can call this
  // route, but by uploadedBy always being forced to the caller's own id
  // server-side (see ServiceReportsService.upload) and by read/read_own
  // scoping the caller's later visibility into what they uploaded — never
  // by hiding this endpoint in the UI. MAX_UPLOAD_BYTES (25 MB, same policy
  // as customer_documents) is enforced at the Multer stream level, not
  // just checked after the fact.
  @Permissions({ module: "service_reports", action: "upload" })
  @Post(":id/service-reports")
  @UseFilters(ServiceReportMulterExceptionFilter)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadServiceReport(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadServiceReportDto,
    @Req() req: AuthedRequest,
  ) {
    return this.serviceReportsService.upload(id, file, dto, actorFrom(req));
  }
}
