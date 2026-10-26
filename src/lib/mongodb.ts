import { MongoClient, type Db } from "mongodb";

const globalForMongo = globalThis as unknown as {
  _mongoClient?: Promise<MongoClient>;
};

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  // 개발 중 HMR이나 서버리스 재사용 시 연결이 늘어나지 않도록 전역에 캐시
  globalForMongo._mongoClient ??= new MongoClient(uri).connect();
  return (await globalForMongo._mongoClient).db("aya");
}
