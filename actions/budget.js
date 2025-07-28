"use server"
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import {db} from "@/lib/prisma"

export async function getCurrentBudget(accountId) {
    try {
        const { userId } = await auth();
        if(!userId) throw new Error("Unauthorized");
        const user = await db.user.findUnique({
            where:{clerkUserId:userId},
        })
        if(!user){
            throw new Error("User not found");
        }
        const budget = await db.budget.findFirst({
            where:{userId:user.id},
        })
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
                userId:user.id,
                type:"EXPENSE",
                date:{
                    gte:startOfMonth,
                    lte:endOfMonth,
                },
                accountId
            },
            _sum:{
                amount:true,
            }
        })
        return{
            budget:budget? {...budget,amount:budget.amount.toNumber()}:null ,
            currentExpenses:expenses._sum.amount?expenses._sum.amount.toNumber():0,
        }
    } catch (error) {
        console.log("Error fetching budget:",error);
    }
}

export async function updateBudget(amount) {
    try {
        const {userId} = await auth();
        if(!userId) throw new Error("Unauthorized");
        const user = await db.user.findUnique({
            where:{clerkUserId:userId},
        })
        if(!user){
            throw new Error("User not found");
        }
        const budget = await db.budget.upsert({
            where:{
                userId:user.id,
            },
            update:{
                amount,
            },
            create:{
                userId:user.id,
                amount,
            },
        })
        console.log(budget)
        revalidatePath("/dashboard");
        return {success:true,data:{...budget,amount:budget.amount.toNumber()}};
    } catch (error) {
        console.error("Error updating budget:",error);
        return {success:false,error:error.message};
    }
}
