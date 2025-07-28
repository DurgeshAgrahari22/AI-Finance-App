// currentUser: Gets the current authenticated user from Clerk
import { currentUser } from "@clerk/nextjs/server"
// db: This is your Prisma Client instance to query the database.
import { db } from "./prisma"

export const checkUser = async()=>{
    
    try {
        const user = await currentUser()
        if(!user) return null
        const loggedInUser = await db.user.findUnique({
            where:{
                clerkUserId:user.id,
            }
        })
        // if we have loggedIn user then do nothing simple return 
        if(loggedInUser){
            return loggedInUser;
        }
        const name = `${user.firstName} ${user.lastName}`
        const newUser = await db.user.create({
            data:{
                clerkUserId:user.id,
                name,
                imageUrl:user.imageUrl,
                email:user.emailAddresses[0].emailAddress
            }
        })
        return newUser;
    } catch (error) {
        console.log(error.message)
    }
}   
