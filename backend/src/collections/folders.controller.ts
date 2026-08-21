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
import { API_VERSION } from '@raven/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateFolderDto } from './dto/create-folder.dto';
import { FolderResponseDto } from './dto/folder-response.dto';
import { MoveFolderDto } from './dto/move-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { FoldersService } from './folders.service';

@Controller({ path: 'folders', version: API_VERSION })
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFolderDto,
  ): Promise<FolderResponseDto> {
    return FolderResponseDto.from(
      await this.foldersService.create(user.userId, dto),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFolderDto,
  ): Promise<FolderResponseDto> {
    return FolderResponseDto.from(
      await this.foldersService.update(user.userId, id, dto),
    );
  }

  /** 409 when the target is the folder's own descendant — see the service. */
  @Patch(':id/move')
  async move(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveFolderDto,
  ): Promise<FolderResponseDto> {
    return FolderResponseDto.from(
      await this.foldersService.move(user.userId, id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.foldersService.remove(user.userId, id);
  }
}
