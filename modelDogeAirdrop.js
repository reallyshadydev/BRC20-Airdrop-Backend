import mongoose from "mongoose";

const RecipientSchema = new mongoose.Schema(
	{
		address: { type: String, required: true },
		status: { type: String, enum: ["queued", "processing", "success", "failed"], default: "queued" },
		attempts: { type: Number, default: 0 },
		lastError: { type: String, default: "" },
		log: { type: String, default: "" },
		txid: { type: String, default: "" }
	},
	{ _id: false }
);

const DogeAirdropJobSchema = new mongoose.Schema(
	{
		fromAddress: { type: String, required: true },
		ticker: { type: String, required: true },
		amount: { type: String, required: true },
		op: { type: String, enum: ["transfer", "mint"], default: "transfer" },
		repeat: { type: Number, default: 1 },
		status: { type: String, enum: ["queued", "processing", "completed", "failed", "cancelled"], default: "queued" },
		recipients: { type: [RecipientSchema], default: [] },
		stats: {
			total: { type: Number, default: 0 },
			processed: { type: Number, default: 0 },
			success: { type: Number, default: 0 },
			failed: { type: Number, default: 0 }
		}
	},
	{ timestamps: true }
);

const DogeAirdropJob = mongoose.models.DogeAirdropJob || mongoose.model("DogeAirdropJob", DogeAirdropJobSchema);
export default DogeAirdropJob;

