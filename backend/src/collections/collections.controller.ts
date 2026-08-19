import {
  Body,
  Controller,
  Delete,
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
import { CollectionsService } from './collections.service';
import { CollectionResponseDto } from './dto/collection-response.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { MoveCollectionDto } from './dto/move-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';

/**
 * Flat and top-level, with the parent id in the `POST` body — matching
 * `TasksController` and every other resource here. One consistent rule, and a
 * collection's URL does not change when it is reordered.
 *
 * There is no `GET`: collections are read through `GET /workspaces/:id/tree`,
 * which is the only thing that ever needs them.
 */
@Controller({ path: 'collections', version: API_VERSION })
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCollectionDto,
  ): Promise<CollectionResponseDto> {
    return CollectionResponseDto.from(
      await this.collectionsService.create(user.userId, dto),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectionDto,
  ): Promise<CollectionResponseDto> {
    return CollectionResponseDto.from(
      await this.collectionsService.update(user.userId, id, dto),
    );
  }

  @Patch(':id/move')
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveCollectionDto,
  ): Promise<CollectionResponseDto> {
    return CollectionResponseDto.from(
      await this.collectionsService.move(user.userId, id, dto.index),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.collectionsService.remove(user.userId, id);
  }
}
