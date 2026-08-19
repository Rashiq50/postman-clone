import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { API_VERSION } from '@postman-clone/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateRequestDto } from './dto/create-request.dto';
import { MoveRequestDto } from './dto/move-request.dto';
import { RequestResponseDto } from './dto/request-response.dto';
import { UpdateRequestDto } from './dto/update-request.dto';
import { RequestsService } from './requests.service';

/**
 * `GET /requests/:id` is the one full read in this feature — the tree carries
 * only the skeleton a sidebar draws, and the editor fetches the rest here.
 */
@Controller({ path: 'requests', version: API_VERSION })
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRequestDto,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(
      await this.requestsService.create(user.userId, dto),
    );
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(
      await this.requestsService.findOne(user.userId, id),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequestDto,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(
      await this.requestsService.update(user.userId, id, dto),
    );
  }

  @Patch(':id/move')
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveRequestDto,
  ): Promise<RequestResponseDto> {
    return RequestResponseDto.from(
      await this.requestsService.move(user.userId, id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.requestsService.remove(user.userId, id);
  }
}
