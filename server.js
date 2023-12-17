// server.js
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const AWS = require('aws-sdk');
const fs = require('fs');
const axios=require('axios');
const app = express();
const PORT = 4242;
const constants=require('./constants');
const multer= require('multer');
const upload = multer({ dest: "consult-images/" })
const OpenAI=require('openai');
require('dotenv').config();
const {Translate}=require('@google-cloud/translate').v2;
const {TranslationServiceClient} = require('@google-cloud/translate');


const CREDENTIALS=JSON.parse(process.env.CREDENTIALS)

const translate= new Translate({
  credentials:CREDENTIALS,
  projectId:CREDENTIALS.project_id
})

const translationClient = new TranslationServiceClient({ credentials:CREDENTIALS,
  projectId:CREDENTIALS.project_id});
const openai=new OpenAI({
    apiKey: constants.OPENAI_ACCESS_KEY
})



const dbMaker=()=> {

  const db=mysql.createConnection({
    host: constants.DB_HOST,
    user: constants.DB_USER,
    password: constants.DB_PASSWORD,
    database: constants.DB_DATABASE,
    port: constants.DB_PORT,
  });
  db.connect();
  return db


}
  


  

AWS.config.update({
    accessKeyId: constants.AWS_ACCESS_KEY_ID,
    secretAccessKey: constants.AWS_SECRET_ACCESS_KEY,
    region: constants.AWS_REGION, // e.g., 'us-east-1'
});

const s3 = new AWS.S3();
const bucketName = constants.AWS_BUCKET_NAME;

const uploadImagesV2 = async (anaylsisId, images) => {
 
      try{
        const imageUrls = [];
        const promises = images.map((img,id) => {
            const filename = String(id);
            imageUrls.push(filename);
            if (anaylsisId) {
            return uploadFileToS3(
                String(anaylsisId)+"/"+filename,
                constants?.AWS_BUCKET_NAME,
                img,
                'json'
            );
            }
          
        });
        const imageUploadStatus = await Promise.all(promises);
        return imageUrls;
        

        }catch(e){
            console.log(e)
        }

    }

    async function uploadFileToS3(fileName, bucketName, body, contentType) {
      let status = false; 
      const params = {
        Bucket: bucketName,
        Key: fileName+".json",
        Body: JSON.stringify(body),
      };
      //contentType && (params.ContentType = contentType);
      const upload = s3.upload(params).promise();
    
      await upload
        .then(function (data) {
          status = true;
        })
        .catch(function (error) {
          logger.error("error in S3 image upload");
          console.log(error.message);
          status = false;
        });
      return status;
    }
    


async function uploadImageToS3(
    file,
    image,
    bucket = constants.AWS_BUCKET_NAME

    ) {
    let status = false;
    const upload = s3
        .upload({ Bucket: bucket, Key: file, Body: image })
        .promise();
    await upload
        .then(function (data) {
        status = true;
        })
        .catch(function (error) {
        logger.error("error in S3 image upload");
        console.log(error.message);
        status = false;
        });
    return status;
    }
  
async function getS3ObjectByFileName(pageName, bucketName) {
  try {
    const params = {
      Bucket: bucketName,
      Key: pageName+".json",
    };

    const data = await s3.getObject(params).promise();
    return data.Body.toString("utf-8");
  } catch (e) {
    throw new Error(`Could not retrieve file from S3: ${e.message}`);
  }
}
    
  
     




// Middleware to parse JSON in request body
app.use(bodyParser.json());

// GET route
app.get('/health', (req, res) => {
  res.json({ message: 'This is a GET request.' });
});
 
//POST route
app.post('/file-upload',upload.array("files",12),async (req,res)=>{
  const db = dbMaker();
    const images=req?.files;
    console.log(images)
    const url="https://vision.googleapis.com/v1/images:annotate?key="+constants.GOOLE_VISION_API_KEY;
    concated_ocr="";
    let res_array=[];

    for (const image of images){
        const image_content=fs.readFileSync(image.path).toString('base64');
        const payload = {
            "requests": [
              {
                "image": { "content": image_content },
                "features": [{ "type": "TEXT_DETECTION" }],
              },
            ],
          };
          
        res_array.push( axios.post(url, payload))

    }
    res_array=await Promise.all(res_array);
    for (const res of res_array){
        concated_ocr+=res.data.responses[0].fullTextAnnotation.text;
    }
    concated_ocr=concated_ocr.substring(0,32000)
    const thread= await openai.beta.threads.create();
    const threadId=thread.id;

    const message= await openai.beta.threads.messages.create(threadId,{
        role:'user',
        content: concated_ocr
    })

    
    const run = await openai.beta.threads.runs.create(threadId,{
        assistant_id:constants.OPEN_AI_ASSITANT_ID
    })

  

    let status=""
    while(status!="completed"){
        const test = await openai.beta.threads.runs.retrieve(
            threadId, 
            run.id
        )
        status=test.status
    }
   
    
    const messages= await openai.beta.threads.messages.list(threadId);
    resultant=JSON.parse(messages.body.data[0].content[0].text.value)
    const messageId=messages.body.data[0].id
    
    lang=req?.query?.lang
    if(lang && lang!="en"){
      for (let key in resultant){
        if (resultant.hasOwnProperty(key)) {
          try{
            [data]=await translate.translate(resultant[key],lang)
            resultant[key]= data
          }catch(e){
            console.log(e)

          }
          
        }
      }
      try{
        for (let key in resultant["parties"]){
          for(let innerkey in resultant["parties"][key]){
            try{
              if( innerKey === "partyRisk"){
                continue;
              }
              [data]=await translate.translate(resultant["parties"][key][innerkey],lang)
              resultant["parties"][key][innerkey]= data
            }catch(e){
              console.log(e)
            }
          }
        }

      }catch(e){
        console.log(e)
      }
      
    }
   
    const query = "INSERT INTO consultation_data (thread_id,message_id) VALUES ('"+ threadId +"','"+ messageId+"');"
    console.log(query)
    db.query(query, (err, result) => {
        if (err) {
          console.error('Error executing query:', err);
        } else {
          console.log('Query executed successfully:', result);
          uploadImagesV2(result.insertId,[resultant])
        }
        db.end();
      });
    
    //res.json({ });
    // executeQuery(query)
    // uploadImagesV2(,images)
    res.json({ parsed: resultant,threadId:threadId});
    // res.json({ OCR: res });

});

app.post('/insight',async (req,res)=>{
  const db = dbMaker();
  const threadId = req.body.threadId;
  const partyName = req.body.partyName;

  const message= await openai.beta.threads.messages.create(threadId,{
      role:'user',
      content: `For \"partyName\":${partyName}, response should be a json object having parent key as keyRisks. Elaborate out on each risk in \"keyRisks\" on why is that a risk and rate each risk among Very High/High/Medium/low/very low. Additionally give risk mitigation strategy for each risk in the \"keyRisks\". The \"keyRisk\" should be an array of object having keys \"riskName"\, \"riskRating"\, \"riskExplanation\",\"riskMitigation\"`
  })


  const run = await openai.beta.threads.runs.create(threadId,{
      assistant_id:constants.OPEN_AI_ASSITANT_ID
  })


  let status=""
  while(status!="completed"){
      const test = await openai.beta.threads.runs.retrieve(
          threadId, 
          run.id
      )
      status=test.status
  }

  const messages= await openai.beta.threads.messages.list(threadId);
  resultant=messages.body.data[0].content[0].text.value;
  console.log(resultant);
  const messageId = messages.body.data[0].id;
  const query = `update consultation_data set insight_message_id = '${messageId}' where thread_id = '${threadId}'`;
    console.log(query)
    db.query(query, (err, result) => {
        if (err) {
          console.error('Error executing query:', err);
        } else {
          console.log('Query executed successfully:', result);
        }
        db.end();
      });
  res.json({ parsed: JSON.parse(resultant)});
})


const getSignedUrlAWS = async (awsParams) => {
  try {
    const signedUrl = await s3.getSignedUrl("getObject", awsParams);
    return signedUrl;
  } catch (err) {
    logger.info(
      "Error occured while getting signed url",
      (err).message
    );
    return false;
  }
};



// Get Route
app.get('/get-list',(req,res)=>{
  const db = dbMaker();
  const query="SELECT * FROM consultation_data;"
  anaylsisIds=[]
  db.query(query,async (err,result)=>{
    if(err){
      console.log(err)
    }else{
      for(ele in result){
        anaylsisIds.push(result[ele]["analysis_id"])
      }
      db.end();
    }

    resultant=[]
    for(const item of anaylsisIds){
      path=constants.AWS_BUCKET_NAME+"/"+String(item)
      fileName="0"
      jsonObj= await getS3ObjectByFileName(fileName, path)
      resultant.push(JSON.parse(jsonObj))
      // const buffer = Buffer.from('7b227469746c65223a22e0a495e0a58de0a4b0e0a587e0a4a1e0a49fe0a49520e0a495e0a4b0e0a58de0a4a120e0a4...', 'hex');
      // const jsonString = buffer.toString('utf8');
      // const jsonObject = JSON.parse(jsonString);
      
      
    
    }
    // anaylsisIds.map(async (item)=>{
    //   const path=constants.AWS_BUCKET_NAME+"/"+String(item.anaylsisId)
    //   res.push(await getSignedUrlAWS(
    //     {
    //       Bucket: path,
    //       Key: "0",
    //     }
    //   ))
    // })

    res.json({resultant:resultant})
  
   
  })
})








// POST route
app.post('/post', (req, res) => {
  const dataFromClient = req.body;
  console.log('Received data from client:', dataFromClient);
  res.json({ message: 'This is a POST request.' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
