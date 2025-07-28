import { sendEmails } from "@/actions/send-email";
import { db } from "../prisma";
import { inngest } from "./client";
import EmailTemplate from "@/emails/template";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const checkBudgetAlert = inngest.createFunction(
  { name: "Check Budget Alerts" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    const budgets = await step.run("fetch-budget", async()=>{
        return await db.budget.findMany({
            include:{
                user:{
                    include:{
                        accounts:{
                            where:{
                                isDefault:true
                            }
                        }
                    }
                }
            }
        })
    })
    for(const budget of budgets){
        const defaultAccount = budget.user.accounts[0];
        if(!defaultAccount) continue; // Skip if no default account
        await step.run(`check-budget-${budget.id}`,async ()=>{

            const currentDate = new Date();
            // start of the month like 01 jan 2025
            const startOfMonth = new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                1
            )
            // 31 jan 2025
            const endOfMonth = new Date(
                currentDate.getFullYear(),
                currentDate.getMonth()+1,
                0
            )
            const expenses = await db.transaction.aggregate({
                where:{
                    userId:budget.userId,
                    accountId:defaultAccount.id,
                    type:"EXPENSE",
                    date:{
                        gte:startOfMonth,
                        lte:endOfMonth,
                    },
                },
                _sum:{
                    amount:true,
                },
            });
            const totalExpenses = expenses._sum.amount?.toNumber() || 0;
            const budgetAmount = budget.amount;
            const percentageUsed = (totalExpenses/budgetAmount)*100;
            if(percentageUsed>=80 && (!budget.lastAlertSent || isNewMonth(new Date(budget.lastAlertSent),new Date()))){
                // send Email
                await sendEmails({
                    to:budget.user.email,
                    subject:`Budget Alert for ${defaultAccount.name}`,
                    react:EmailTemplate({
                        userName:budget.user.name,
                        type:"budget-alert",
                        data:{
                            percentageUsed,
                            budgetAmount: parseInt(budgetAmount).toFixed(1),
                            totalExpenses: parseInt(totalExpenses).toFixed(1),
                            accountName: defaultAccount.name
                        }
                    })
                })
                // update lastAlertSent
                await db.budget.update({
                    where:{id:budget.id},
                    data:{lastAlertSent:new Date()}
                })
            }
        })
    }
  },
);  


function isNewMonth(lastAlertDate, currentDate){
    return (
        lastAlertDate.getMonth() !== currentDate.getMonth() ||
        lastAlertDate.getFullYear() !== currentDate.getFullYear()
    )
}

export const triggerRecurringTransaction = inngest.createFunction({
    id: "trigger-recurring-transaction",
    name:"Trigger Recurring Transaction",
},{cron:"0 0 * * *"},async({step})=>{
    // 1. Fetch all due recurring transactions
    const recurringTransaction = await step.run(
        "fetch-recurring-transaction",
        async()=>{
            return await db.transaction.findMany({
                where:{
                    isRecurring: true,
                    status: "COMPLETED",
                    OR:[
                        {lastProcessed: null}, // Never Processed
                        {nextRecurringDate: {lte:new Date()}}, // Due date passed
                    ]
                }
            })
        }
    )
    // 2. Create events for each transaction
    if(recurringTransaction.length>0){
        const events = recurringTransaction.map((transaction)=>({
            name:"transaction.recurring.process",
            data:{ transactionId:transaction.id, userId:transaction.userId },
        }))
        // 3. Send events to be processed
        await inngest.send(events);
    }
    return {triggered: recurringTransaction.length};
})


export const processRecurringTransaction = inngest.createFunction({
    id:"process-recurring-transaction",
    throttle:{
        limit:10, // Only process 10 transactions
        period:"1m", // per minute
        key:"event.data.userId" // per user
    },
},
    {event:"transaction.recurring.process"},
    async ({event,step})=>{
        // Validate event data
        if(!event?.data?.transactionId || !event?.data?.userId){
            console.error("Invalid event data:", event);
            return {error: "Missing required event data"};
        }
        await step.run("process-transaction", async()=>{
            const transaction = await db.transaction.findUnique({
                where:{
                    id:event.data.transactionId,
                    userId: event.data.userId,
                },
                include:{
                    account:true
                }
            })
            if(!transaction || !isTransactionDue(transaction))return;
            await db.$transaction(async(tx)=>{
                // Create new transaction
                await tx.transaction.create({
                    data:{
                        type:transaction.type,
                        amount:transaction.amount,
                        description:`${transaction.description} (Recurring)`,
                        date: new Date(),
                        category: transaction.category,
                        userId: transaction.userId,
                        accountId: transaction.accountId,
                        isRecurring: false
                    }
                })
                // Update account balance
                const balanceChange = transaction.type === "EXPENSE"? -transaction.amount.toNumber():transaction.amount.toNumber();
                await tx.account.update({
                    where:{id:transaction.accountId},
                    data:{balance: {increment: balanceChange}},
                })
                
                // Update last processed date and next recurring date
                await tx.transaction.update({
                    where:{id:transaction.id},
                    data:{
                        lastProcessed:new Date(),
                        nextRecurringDate: calculateNextRecurringDate(
                            new Date(),
                            transaction.recurringInterval
                        )
                    }
                })
            })
        })
    }
)

function isTransactionDue(transaction){
    // If no lastProcessed date, transaction is due
    if(!transaction.lastProcessed)return true;
    const today = new Date();
    const nextDue = new Date(transaction.nextRecurringDate);

    // Compare with nextDue date
    return nextDue<=today;
}

function calculateNextRecurringDate(startDate, interval) {
  const date = new Date(startDate);
  switch (interval) {
    case "DAILY":
      date.setDate(date.getDate() + 1);
      break;
    case "WEEKLY":
      date.setDate(date.getDate() + 7);
      break;
    case "MONTHLY":
      date.setMonth(date.getMonth() + 1);
      break;
    case "YEARLY":
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  return date;
}

export const generateMonthlyReports = inngest.createFunction(
  {
    id: "generate-monthly-reports",
    name: "Generate Monthly Reports",
  },
  { cron: "0 0 1 * *" }, // Run on the 1st day of every month
  async ({ step }) => {
    const users = await step.run("fetch-users", async () => {
      return await db.user.findMany({
        include: { accounts: true },
      });
    });

    for (const user of users) {
      await step.run(`generate-report-${user.id}`, async () => {
        try {
          const lastMonth = new Date();
          lastMonth.setMonth(lastMonth.getMonth() - 1);
          const stats = await getMonthlyStats(user.id, lastMonth);
          const monthName = getMonthName(lastMonth);
           // Generate AI insights
          const insights = await generateFinancialInsights(stats, monthName);

          await sendEmails({
            to: user.email,
            subject: `Your Monthly Financial Report - ${monthName}`,
            react: EmailTemplate({
              userName: user.name,
              type: "monthly-report",
              data: {
                stats,
                month: monthName,
                insights,
              },
            }),
          });
        } catch (error) {
          console.error(`Error processing report for user ${user.id}:`, error);
        }
      });

    }

    return { processed: users.length };
  }
);

function getMonthName(date) {
  return date.toLocaleString("default", { month: "long" });
}

//  Generate Insights Using Gemini
 async function generateFinancialInsights(stats, month) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
   
    const prompt = `Analyze this financial data and provide 3 concise, actionable insights.
    Focus on spending patterns and practical advice.
    Keep it friendly and conversational.

    Financial Data for ${month}:
    - Total Income: $${stats.totalIncome}
    - Total Expenses: $${stats.totalExpenses}
    - Net Income: $${stats.totalIncome - stats.totalExpenses}
    - Expense Categories: ${Object.entries(stats.byCategory)
        .map(([cat, amt]) => `${cat}: $${amt}`)
        .join(", ")}

    Format as a JSON array of strings: ["insight 1", "insight 2", "insight 3"]`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();
    const cleaned = rawText.replace(/```(?:json)?\n?/g, "").trim();

    return JSON.parse(cleaned);
  } catch (error) {
    console.error("AI Insight Error:", error);
    return [
      "Your highest expense category this month might need attention.",
      "Consider setting up a budget for better financial management.",
      "Track your recurring expenses to identify potential savings.",
    ];
  }
}

// === Helper: Get Stats from DB ===
async function getMonthlyStats(userId, month) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  const transactions = await db.transaction.findMany({
    where: {
      userId,
      date: {
        gte: start,
        lte: end,
      },
    },
  });

  return transactions.reduce(
    (acc, t) => {
      const amount = t.amount.toNumber();
      if (t.type === "EXPENSE") {
        acc.totalExpenses += amount;
        acc.byCategory[t.category] = (acc.byCategory[t.category] || 0) + amount;
      } else {
        acc.totalIncome += amount;
      }
      return acc;
    },
    {
      totalExpenses: 0,
      totalIncome: 0,
      byCategory: {},
      transactionCount: transactions.length,
    }
  );
}
