const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 5000;
const cors = require('cors');
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

app.use(cors());
app.use(express.json());

// JWT verfication
const jwtVerify = (req, res, next) => {
    const authorization = req.headers.authorization;
    
    if(!authorization) {
        return res.status(401).send({error:true, message: 'Unauthorized Access'});
    }

    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({error:true, message: 'Unauthorized Access'});
        }
        req.decoded = decoded;
        next();
    });
} 




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hcsitps.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        client.connect();

        const userCollection = client.db("bistroDB").collection("users");
        const menuCollection = client.db("bistroDB").collection("menu");
        const reviewCollection = client.db("bistroDB").collection("reviews");
        const cartCollection = client.db("bistroDB").collection("carts");
        const paymentCollection = client.db("bistroDB").collection("payments");

        /**
         * ----------------------------------------- JWT --------------------------------
         */
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn : '1h' });
            res.send({token});
        });

        // Admin Middleware: Must use after using jwtVerify cause email we got from jwtVerify middleware
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email};
            const user = await userCollection.findOne(query);
            if (user?.role !== 'admin') {
               return res.status(403).send({ error: true, message : `Forbidden Access` });
            }
            next();
        }

        /**
         * ------------------------------ User Collection --------------------------------
         * To Protect Users route:
         * 0. Do not show secure links to those who should not see the links
         * 1. use jwt token: jwtVerify
         * 2. use verifyAdmin middleware N>B> Must use jwtVerify before use this middleware
         */
        app.get('/users', jwtVerify, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });


        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email : user.email };
            const existingUser = await userCollection.findOne(query);
            if(existingUser) {
                return res.send({ message: 'user already exists'});
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users/admin/:email', jwtVerify, async (req, res) => {
            const email = req.params.email;

            if (email !== req.decoded.email) {
                res.send({admin : false});
            }

            const query = { email: email};
            const user = await userCollection.findOne(query);
            const result = { admin: user?.role === 'admin' };
            res.send(result);
        });

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id : new ObjectId(id)};
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };
            const result = await userCollection.updateOne(query, updateDoc);
            res.send(result);
        });

        /**
         * ------------------------------ Menu Collection --------------------------------
         */
        app.get('/menu', async (req, res) => {
            const result = await menuCollection.find().toArray();
            res.send(result);
        });

        app.post('/menu', jwtVerify, verifyAdmin, async (req, res) => {
            const newItem = req.body;
            const result = await menuCollection.insertOne(newItem);
            res.send(result);
        });

        app.delete('/menu/:id', jwtVerify, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: id };
            const result = await menuCollection.deleteOne(query);
            res.send(result);
        })


        /**
         * ------------------------------ Review Collection --------------------------------
         */


        /**
         * ------------------------------ Cart Collection --------------------------------
         */

        app.get('/carts', jwtVerify, async (req, res) => {
            const email = req.query.email;
            // console.log(email);
            if (!email) {
                res.send([]);
            }
            // console.log(req.decoded);
            const decodedEmail = req.decoded.email;
            console.log(decodedEmail);

            if(email !== decodedEmail) {
                return res.status(403).send({error: true, message: 'Forbidden Access'});
            }

            const query = { email : email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/carts', async (req, res) => {
            const item = req.body;
            // console.log(item);
            const result = await cartCollection.insertOne(item);
            res.send(result);
        });

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            // console.log(id);
            const query = { _id : new ObjectId(id)};
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        /**
         * ----------------------------- Create Payment Intent --------------------------------
         */
        app.post('/create-payment-intent', async (req, res) => {
            const {price} = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount : amount,
                currency : 'usd',
                payment_method_types: ['card']
            });

            res.send({ clientSecret: paymentIntent.client_secret});
        });

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            const query = { _id : { $in : payment.cartItems.map(id => new ObjectId(id))}};
            const deleteResult = await cartCollection.deleteMany(query);

            res.send({insertResult, deleteResult});
        });


        /**
         * ----------------------------- Admin Stats --------------------------------
         */
        app.get('/admin-stats', jwtVerify, verifyAdmin, async (req, res) => {

            const customers = await userCollection.estimatedDocumentCount();
            const products = await menuCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();
            // Method 1
            const revinew = await paymentCollection.aggregate([
                {
                  $group: {
                    _id: null,
                    total: {
                      $sum: "$price"
                    }
                  }
                }
              ]).toArray();

            // Method 2
            const payment = await paymentCollection.find().toArray();
            const revinew2 = payment.reduce((sum, payment) => sum + payment.price, 0);  

            res.send({
                customers,
                products,
                orders,
                revinew: revinew[0].total.toFixed(2),
                // revinew2
            });

        });

        app.get('/order-stats', jwtVerify, verifyAdmin, async (req, res) => {
            const pipeline = [
                {
                  $lookup: {
                    from: 'menu',
                    localField: 'menuItems',
                    foreignField: '_id',
                    as: 'menuItemsData'
                  }
                },
                {
                  $unwind: '$menuItemsData'
                },
                {
                  $group: {
                    _id: '$menuItemsData.category',
                    count: { $sum: 1 },
                    total: { $sum: '$menuItemsData.price' }
                  }
                },
                {
                  $project: {
                    category: '$_id',
                    count: 1,
                    total: { $round: ['$total', 2] },
                    _id: 0
                  }
                }
              ];
        
              const result = await paymentCollection.aggregate(pipeline).toArray();
              res.send(result);
        });


        // Send a ping to confirm a successful connection
        await client.db("admin").command({  ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);






app.get('/', (req, res) => res.send('Bismillahir Rahmanir Rahim - ML-12-Bistro-Boss Restaurent'));
app.listen(port, () => console.log(`Server is running from port: ${port}`));