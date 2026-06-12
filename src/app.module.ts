import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';

const mongoUri: string =
  process.env.MONGODB_URI ?? 'mongodb://localhost:27017/memoflow';

@Module({
  imports: [MongooseModule.forRoot(mongoUri)],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
