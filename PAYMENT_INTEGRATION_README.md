# Payment Model Addition

To complete Phase 7, add the following Payment model to apps/backend/prisma/schema.prisma:

model Payment {
  id            String   @id @default(cuid())
  userId        String
  bookingId     String?
  triageCaseId  String?
  amount        Int
  currency      String   @default("ZAR")
  status        String   @default("PENDING")
  gatewayRef    String?
  paymentMethod String?
  metadata      Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  user          User     @relation(fields: [userId], references: [id])
  booking       Booking? @relation(fields: [bookingId], references: [id])
  triageCase    TriageCase? @relation(fields: [triageCaseId], references: [id])
  
  @@index([userId])
  @@index([bookingId])
  @@index([triageCaseId])
  @@index([status])
}

Then run:
```bash
npx prisma generate
npx prisma migrate dev --name add_payment_model
```
